import { useState, useEffect, FC, forwardRef, useCallback } from 'react';

import CloseIcon from '@mui/icons-material/Close';
import {
  AppBar,
  Button,
  Dialog,
  IconButton,
  Link,
  Slide,
  Toolbar,
  Typography
} from '@mui/material';
import { TransitionProps } from '@mui/material/transitions';
import * as Sentry from '@sentry/react';
import { useNavigate } from 'react-router-dom';
import { TrustSetFlags as TrustSetFlagsBitmask } from 'xrpl';
import { AccountLinesTrustline } from 'xrpl';

import { Network } from '@gemwallet/constants';

import {
  ADD_NEW_TRUSTLINE_PATH,
  DEFAULT_RESERVE,
  ERROR_RED,
  RESERVE_PER_OWNER
} from '../../../constants';
import { useLedger, useNetwork, useServer } from '../../../contexts';
import { convertHexCurrencyString } from '../../../utils';
import { TokenLoader } from '../../atoms';
import { InformationMessage } from '../../molecules/InformationMessage';
import { TokenDisplay } from '../../molecules/TokenDisplay';

const LOADING_STATE = 'Loading...';
const ERROR_STATE = 'Error';

interface TrustLineBalance {
  value: string;
  currency: string;
  issuer: string;
  trustlineDetails?: {
    // Details need to be fetched with a separate call
    limit: number;
    noRipple: boolean;
  };
}
export interface TokenListingProps {
  address: string;
}

const Transition = forwardRef(function Transition(
  props: TransitionProps & {
    children: React.ReactElement;
  },
  ref: React.Ref<unknown>
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

export const TokenListing: FC<TokenListingProps> = ({ address }) => {
  const [XRPBalance, setXRPBalance] = useState<string>(LOADING_STATE);
  const [reserve, setReserve] = useState<number>(DEFAULT_RESERVE);
  const [ownerReserve, setOwnerReserve] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [trustLineBalances, setTrustLineBalances] = useState<TrustLineBalance[]>([]);
  const [explanationOpen, setExplanationOpen] = useState(false);
  const { client, reconnectToNetwork, networkName } = useNetwork();
  const { serverInfo } = useServer();
  const { fundWallet, getAccountInfo } = useLedger();
  const navigate = useNavigate();

  useEffect(() => {
    async function fetchBalance() {
      try {
        // Retrieve balances without trustline details
        const balances = await client?.getBalances(address);
        const XRPBalance = balances?.find((balance) => balance.issuer === undefined);
        let trustLineBalances = balances?.filter(
          (balance) => balance.issuer !== undefined
        ) as TrustLineBalance[];

        // Retrieve trustlines details
        const accountLines = await client?.request({
          command: 'account_lines',
          account: address
        });

        if (accountLines?.result?.lines) {
          trustLineBalances = trustLineBalances
            .map((trustlineBalance) => {
              const trustlineDetails = accountLines.result.lines.find(
                (line: AccountLinesTrustline) =>
                  line.currency === trustlineBalance.currency &&
                  line.account === trustlineBalance.issuer
              );

              return {
                ...trustlineBalance,
                trustlineDetails:
                  trustlineDetails && Number(trustlineDetails.limit)
                    ? {
                        limit: Number(trustlineDetails.limit),
                        noRipple: trustlineDetails.no_ripple === true
                      }
                    : undefined
              };
            })
            .filter(
              (trustlineBalance) =>
                trustlineBalance.trustlineDetails || trustlineBalance.value !== '0'
            ); // Hide revoked trustlines with a balance of 0
        }

        if (XRPBalance) {
          setXRPBalance(XRPBalance.value);
        }
        if (trustLineBalances) {
          setTrustLineBalances(trustLineBalances);
        }
      } catch (e: any) {
        if (e?.data?.error !== 'actNotFound') {
          Sentry.captureException(e);
        }
        setXRPBalance(ERROR_STATE);
      }
    }

    fetchBalance();
  }, [address, client]);

  const handleOpen = useCallback(() => {
    setExplanationOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setExplanationOpen(false);
  }, []);

  const handleFundWallet = useCallback(() => {
    setErrorMessage('');
    setXRPBalance(LOADING_STATE);
    fundWallet()
      .then(({ balance }) => setXRPBalance(balance.toString()))
      .catch((e) => {
        setXRPBalance(ERROR_STATE);
        setErrorMessage(e.message);
      });
  }, [fundWallet]);

  if (client === null) {
    return (
      <InformationMessage
        title="Failed to connect to the network"
        style={{
          padding: '15px'
        }}
      >
        <Typography style={{ marginBottom: '5px' }}>
          There was an error attempting to connect to the network. Please refresh the page and try
          again.
        </Typography>
        <div style={{ textAlign: 'center', margin: '10px 0' }}>
          <Button variant="contained" onClick={reconnectToNetwork} style={{ marginBottom: '10px' }}>
            Refresh
          </Button>
          {errorMessage && <Typography style={{ color: ERROR_RED }}>{errorMessage}</Typography>}
        </div>
      </InformationMessage>
    );
  }

  if (XRPBalance === LOADING_STATE) {
    return <TokenLoader />;
  }
  const baseReserve = serverInfo?.info.validated_ledger?.reserve_base_xrp || DEFAULT_RESERVE;
  getAccountInfo()
    .then((accountInfo) => {
      setOwnerReserve(accountInfo.result.account_data.OwnerCount * RESERVE_PER_OWNER);
      setReserve(accountInfo.result.account_data.OwnerCount * RESERVE_PER_OWNER + baseReserve);
    })
    .catch((e) => {
      setOwnerReserve(0);
      setReserve(DEFAULT_RESERVE);
    });

  if (XRPBalance === ERROR_STATE) {
    return (
      <InformationMessage title="Account not activated">
        <div style={{ marginBottom: '5px' }}>
          To create this account to the XRP ledger, you will have to make a first deposit of a
          minimum {reserve} XRP.
        </div>
        <Link
          href="https://xrpl.org/reserves.html?utm_source=gemwallet.app"
          target="_blank"
          rel="noreferrer"
        >
          Learn more about the account reserve.
        </Link>
        <div style={{ marginTop: '5px' }}>
          Your reserved XRP will not show up within your GemWallet's balance as you cannot spend it.
        </div>

        {(networkName === Network.TESTNET || networkName === Network.DEVNET) && (
          <div style={{ margin: '15px 0px', textAlign: 'center' }}>
            <Button variant="contained" onClick={handleFundWallet} data-testid="fund-wallet-button">
              Fund Wallet
            </Button>
          </div>
        )}
      </InformationMessage>
    );
  }

  return (
    <div>
      <TokenDisplay
        balance={Number(XRPBalance) - reserve}
        token="XRP"
        isXRPToken
        onExplainClick={handleOpen}
      />
      {trustLineBalances.map((trustedLine) => {
        const currencyToDisplay = convertHexCurrencyString(trustedLine.currency);
        const canBeEdited = trustedLine.trustlineDetails || trustedLine.value !== '0';
        const limit = trustedLine.trustlineDetails?.limit || 0;
        const noRipple = trustedLine.trustlineDetails?.noRipple || false;
        const flags = noRipple ? TrustSetFlagsBitmask.tfSetNoRipple : undefined;
        const limitAmount = {
          currency: convertHexCurrencyString(trustedLine.currency),
          issuer: trustedLine.issuer,
          value: limit
        };
        return (
          <TokenDisplay
            balance={Number(trustedLine.value)}
            token={currencyToDisplay}
            key={`${trustedLine.issuer}|${currencyToDisplay}`}
            trustlineLimit={
              trustedLine.trustlineDetails?.limit ? trustedLine.trustlineDetails?.limit : 0
            }
            trustlineNoRipple={noRipple}
            // Show the Edit Trustline button if the trustline is not revoked or if the trustline has a non-zero balance
            onTrustlineDetailsClick={
              canBeEdited
                ? () =>
                    navigate(
                      `${ADD_NEW_TRUSTLINE_PATH}?showForm=true&inAppCall=true&limitAmount=${JSON.stringify(
                        limitAmount
                      )}&flags=${flags}`
                    )
                : undefined
            }
          />
        );
      })}
      <div style={{ height: '60px' }} />
      <Dialog
        fullScreen
        open={explanationOpen}
        onClose={handleClose}
        TransitionComponent={Transition}
      >
        <AppBar sx={{ position: 'relative' }}>
          <Toolbar>
            <IconButton edge="start" color="inherit" onClick={handleClose} aria-label="close">
              <CloseIcon />
            </IconButton>
            <Typography sx={{ ml: 2, flex: 1 }} variant="h6" component="div">
              Account balance
            </Typography>
          </Toolbar>
        </AppBar>
        <div style={{ margin: '20px' }}>
          <InformationMessage
            title="Information"
            style={{
              padding: '15px'
            }}
          >
            <Typography style={{ marginBottom: '5px' }}>
              The activation of this XRP ledger account was made through a minimum deposit of{' '}
              {baseReserve} XRP.
            </Typography>
            <Link
              href="https://xrpl.org/reserves.html?utm_source=gemwallet.app"
              target="_blank"
              rel="noreferrer"
            >
              Learn more about the account reserve.
            </Link>
          </InformationMessage>
          <Typography style={{ margin: '20px 0 10px 0' }}>Account balance</Typography>
          <TokenDisplay balance={Number(XRPBalance)} isXRPToken token="XRP" />
          <Typography style={{ margin: '20px 0 10px 0' }}>Amount that can be spent</Typography>
          <TokenDisplay balance={Number(XRPBalance) - reserve} isXRPToken token="XRP" />
          <Typography style={{ margin: '20px 0 10px 0' }}>Base reserve</Typography>
          <TokenDisplay balance={baseReserve} isXRPToken token="XRP" />
          <Typography style={{ margin: '20px 0 10px 0' }}>Owner reserve</Typography>
          <TokenDisplay balance={ownerReserve} isXRPToken token="XRP" />
        </div>
      </Dialog>
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          position: 'fixed',
          bottom: 57,
          left: 0,
          right: 0,
          zIndex: 1,
          backgroundColor: '#1d1d1d'
        }}
      >
        <Button
          variant="contained"
          onClick={() => navigate(`${ADD_NEW_TRUSTLINE_PATH}?showForm=true&inAppCall=true`)}
          style={{ margin: '10px 0' }}
        >
          Add trustline
        </Button>
      </div>
    </div>
  );
};
