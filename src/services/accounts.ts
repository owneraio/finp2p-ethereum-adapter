import Asset = Components.Schemas.Asset;


export class Account {

  balances: Record<string, number> = {};

  balance(assetCode: string): number {
    return this.balances[assetCode] || 0;
  }

  debit(assetCode: string, amount: number) {
    this.balances[assetCode] = (this.balances[assetCode] || 0) - amount;
  }

  credit(assetCode: string, amount: number) {
    this.balances[assetCode] = (this.balances[assetCode] || 0) + amount;
  }
}

export class AccountService {

  accounts: Record<string, Account> = {};

  getBalance(finId: string, asset: Asset): number {
    let account = this.accounts[finId];
    if (account === undefined) {
      return 0;
    }
    let assetCode = AccountService.extractAssetCode(asset);
    return account.balance(assetCode);
  }

  debit(from: string, amount: number, asset: Asset) {
    let assetCode = AccountService.extractAssetCode(asset);
    this.getOrCreateAccount(from).debit(assetCode, amount);
  }

  credit(to: string, amount: number, asset: Asset) {
    let assetCode = AccountService.extractAssetCode(asset);
    this.getOrCreateAccount(to).credit(assetCode, amount);
  }

  move(from: string, to: string, amount: number, asset: Asset) {
    let assetCode = AccountService.extractAssetCode(asset);
    this.getOrCreateAccount(from).debit(assetCode, amount);
    this.getOrCreateAccount(to).credit(assetCode, amount);
  }

  getOrCreateAccount(finId: string): Account {
    let account = this.accounts[finId];
    if (account !== undefined) {
      return account;
    } else {
      const newAccount = new Account();
      this.accounts[finId] = newAccount;
      return newAccount;
    }
  }

  static extractAssetCode(asset: Asset): string {
    switch (asset.type) {
      case 'cryptocurrency':
        return asset.code;
      case 'fiat':
        return asset.code;
      case 'finp2p':
        return asset.resourceId;
      default:
        throw new Error('unknown asset type');
    }
  }
}