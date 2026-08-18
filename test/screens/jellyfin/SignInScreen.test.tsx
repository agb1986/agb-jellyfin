import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { JellyfinProvider } from '../../../src/jellyfin/react/JellyfinProvider';
import { MemoryKeyValueStore } from '../../../src/jellyfin/storage/KeyValueStore';
import SignInScreen from '../../../src/screens/jellyfin/SignInScreen';

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    text: async () => JSON.stringify(body),
  }) as Response;

const renderSignIn = (fetchImpl: jest.Mock) =>
  render(
    <JellyfinProvider
      store={new MemoryKeyValueStore()}
      clientInfo={{ name: 'Jellyfin Vega', version: '0.1.0' }}
      deviceName="Living Room"
      serverUrl="http://jellyfin.local:8096"
      fetchImpl={fetchImpl as unknown as typeof fetch}>
      <SignInScreen pollIntervalMs={5} />
    </JellyfinProvider>,
  );

describe('SignInScreen', () => {
  it('shows the Quick Connect code for the user to approve', async () => {
    const fetchImpl = jest
      .fn()
      // isQuickConnectEnabled
      .mockResolvedValueOnce(jsonResponse(true))
      // initiate
      .mockResolvedValueOnce(jsonResponse({ Code: '482913', Secret: 's3cr3t' }))
      // poll — never approved during the test
      .mockResolvedValue(jsonResponse({ Authenticated: false }));

    renderSignIn(fetchImpl);

    await waitFor(() =>
      expect(
        screen.getByTestId('jellyfin-quick-connect-code').props.children,
      ).toBe('482913'),
    );
  });

  it('says so when Quick Connect is switched off server-side', async () => {
    // Otherwise this surfaces as an unexplained failure to get a code, and the
    // fix — a checkbox in the server dashboard — is not guessable from the TV.
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(false));

    renderSignIn(fetchImpl);

    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-sign-in-error').props.children).toMatch(
        /switched off on the server/,
      ),
    );
  });

  it('offers a retry that asks for a fresh code', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(false))
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse({ Code: '112233', Secret: 's' }))
      .mockResolvedValue(jsonResponse({ Authenticated: false }));

    renderSignIn(fetchImpl);

    await waitFor(() => screen.getByTestId('jellyfin-sign-in-retry'));
    fireEvent.press(screen.getByTestId('jellyfin-sign-in-retry'));

    await waitFor(() =>
      expect(
        screen.getByTestId('jellyfin-quick-connect-code').props.children,
      ).toBe('112233'),
    );
  });

  it('surfaces a transport failure rather than waiting forever', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    renderSignIn(fetchImpl);

    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-sign-in-error').props.children).toMatch(
        /Sign-in failed/,
      ),
    );
  });
});
