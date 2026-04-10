import { EvmNetworkMappingValidator, FIELD_CHAIN_ID, FIELD_RPC_URL, FIELD_SUBMIT_MODE, FIELD_FINALITY_CONFIRMATIONS, EVM_NETWORK_FIELDS } from '../src/services/direct/network-mapping-validator';

describe('EvmNetworkMappingValidator', () => {
  const validator = new EvmNetworkMappingValidator();

  describe('chainId', () => {
    it('accepts valid chain ID', async () => {
      const result = await validator.validate('net-1', { [FIELD_CHAIN_ID]: '11155111' });
      expect(result[FIELD_CHAIN_ID]).toBe('11155111');
    });

    it('rejects non-integer chain ID', async () => {
      await expect(validator.validate('net-1', { [FIELD_CHAIN_ID]: 'abc' }))
        .rejects.toThrow('Invalid chainId');
    });

    it('rejects zero chain ID', async () => {
      await expect(validator.validate('net-1', { [FIELD_CHAIN_ID]: '0' }))
        .rejects.toThrow('Invalid chainId');
    });

    it('rejects negative chain ID', async () => {
      await expect(validator.validate('net-1', { [FIELD_CHAIN_ID]: '-1' }))
        .rejects.toThrow('Invalid chainId');
    });
  });

  describe('rpcUrl', () => {
    it('accepts valid URL', async () => {
      const result = await validator.validate('net-1', { [FIELD_RPC_URL]: 'https://rpc.example.com' });
      expect(result[FIELD_RPC_URL]).toBe('https://rpc.example.com');
    });

    it('rejects invalid URL', async () => {
      await expect(validator.validate('net-1', { [FIELD_RPC_URL]: 'not-a-url' }))
        .rejects.toThrow('Invalid rpcUrl');
    });
  });

  describe('submitMode', () => {
    it('accepts custody-submit', async () => {
      const result = await validator.validate('net-1', { [FIELD_SUBMIT_MODE]: 'custody-submit' });
      expect(result[FIELD_SUBMIT_MODE]).toBe('custody-submit');
    });

    it('accepts adapter-submit', async () => {
      const result = await validator.validate('net-1', { [FIELD_SUBMIT_MODE]: 'adapter-submit' });
      expect(result[FIELD_SUBMIT_MODE]).toBe('adapter-submit');
    });

    it('rejects unknown submit mode', async () => {
      await expect(validator.validate('net-1', { [FIELD_SUBMIT_MODE]: 'unknown' }))
        .rejects.toThrow('Invalid submitMode');
    });
  });

  describe('finalityConfirmations', () => {
    it('accepts zero', async () => {
      const result = await validator.validate('net-1', { [FIELD_FINALITY_CONFIRMATIONS]: '0' });
      expect(result[FIELD_FINALITY_CONFIRMATIONS]).toBe('0');
    });

    it('accepts positive integer', async () => {
      const result = await validator.validate('net-1', { [FIELD_FINALITY_CONFIRMATIONS]: '12' });
      expect(result[FIELD_FINALITY_CONFIRMATIONS]).toBe('12');
    });

    it('rejects negative', async () => {
      await expect(validator.validate('net-1', { [FIELD_FINALITY_CONFIRMATIONS]: '-1' }))
        .rejects.toThrow('Invalid finalityConfirmations');
    });

    it('rejects non-integer', async () => {
      await expect(validator.validate('net-1', { [FIELD_FINALITY_CONFIRMATIONS]: '1.5' }))
        .rejects.toThrow('Invalid finalityConfirmations');
    });
  });

  it('passes through all valid fields together', async () => {
    const fields = {
      [FIELD_CHAIN_ID]: '1',
      [FIELD_RPC_URL]: 'https://mainnet.infura.io/v3/key',
      [FIELD_SUBMIT_MODE]: 'adapter-submit',
      [FIELD_FINALITY_CONFIRMATIONS]: '3',
    };
    const result = await validator.validate('evm-mainnet', fields);
    expect(result).toEqual(fields);
  });

  it('passes through unknown fields without validation', async () => {
    const result = await validator.validate('net-1', { customField: 'value' });
    expect(result.customField).toBe('value');
  });
});

describe('EVM_NETWORK_FIELDS', () => {
  it('exposes expected field metadata', () => {
    const fieldNames = EVM_NETWORK_FIELDS.map(f => f.field);
    expect(fieldNames).toContain(FIELD_CHAIN_ID);
    expect(fieldNames).toContain(FIELD_RPC_URL);
    expect(fieldNames).toContain(FIELD_SUBMIT_MODE);
    expect(fieldNames).toContain(FIELD_FINALITY_CONFIRMATIONS);
    for (const f of EVM_NETWORK_FIELDS) {
      expect(f.description).toBeTruthy();
      expect(f.exampleValue).toBeTruthy();
    }
  });
});
