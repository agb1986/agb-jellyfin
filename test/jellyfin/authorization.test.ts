import {
  AUTHORIZATION_HEADER,
  buildAuthorizationHeader,
} from '../../src/jellyfin/authorization';

const clientInfo = { name: 'Jellyfin Vega', version: '0.1.0' };
const deviceInfo = { name: 'Living Room', id: 'device-abc' };

describe('buildAuthorizationHeader', () => {
  it('emits the MediaBrowser scheme with every field the server reads', () => {
    expect(buildAuthorizationHeader(clientInfo, deviceInfo, 'token-123')).toBe(
      'MediaBrowser Client="Jellyfin%20Vega", Device="Living%20Room", ' +
        'DeviceId="device-abc", Version="0.1.0", Token="token-123"',
    );
  });

  it('still emits a Token field when signed out', () => {
    // The server reads Client/Device/DeviceId on unauthenticated calls, so the
    // header cannot simply be omitted before sign-in.
    expect(buildAuthorizationHeader(clientInfo, deviceInfo)).toContain(
      'Token=""',
    );
  });

  it('escapes values that would otherwise split the header into extra fields', () => {
    const header = buildAuthorizationHeader(
      clientInfo,
      { name: 'Kitchen", Device="spoof', id: 'a,b' },
      '',
    );
    expect(header).not.toContain('Kitchen", Device="spoof');
    expect(header).toContain('Device="Kitchen%22%2C%20Device%3D%22spoof"');
    expect(header).toContain('DeviceId="a%2Cb"');
  });

  it('names the header Jellyfin expects', () => {
    expect(AUTHORIZATION_HEADER).toBe('Authorization');
  });
});
