import { OpComponents } from "@owneraio/finp2p-client/dist/finapi";
import { ExecutionPlan, Contract, Leg, Role, Asset } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { ValidationError } from "@owneraio/finp2p-nodejs-skeleton-adapter/dist/lib/services/errors";


export const assetFromAPI = (asset: OpComponents['schemas']['asset']): Asset => {
  switch (asset.type) {
    case 'finp2p':
      return { assetType: 'finp2p', assetId: asset.resourceId };
    case 'cryptocurrency':
      return { assetType: 'cryptocurrency', assetId: asset.code };
    case 'fiat':
      return { assetType: 'fiat', assetId: asset.code };
  }
};

const legFromAssetOrder = (order: OpComponents['schemas']['assetOrder']): Leg => {
  const { term, instruction } = order;
  if (!term) {
    throw new ValidationError('No term in order');
  }
  if (!instruction) {
    throw new ValidationError('No instruction in order');
  }
  let leg: Leg = {
    asset: assetFromAPI(term.asset),
    amount: term.amount,
    organizationId: '',
  };

  const { sourceAccount, destinationAccount } = instruction;
  if (sourceAccount) {
    const { account } = sourceAccount;
    if (account.type === 'finId') {
      const { finId, orgId } = account;
      leg.source = {
        profileId: '',
        role: Role.Unknown,
        finId,
        orgId: orgId ? orgId : '',
      };
      leg.organizationId = orgId ? orgId : '';
    }
  }
  if (destinationAccount) {
    const { account } = destinationAccount;
    if (account.type === 'finId') {
      const { finId, orgId } = account;
      leg.destination = {
        profileId: '',
        role: Role.Unknown,
        finId,
        orgId: orgId ? orgId : '',
      };
      leg.organizationId = orgId ? orgId : '';
    }
  }

  return leg;
};

const legFromAssetOrderOpt = (order?: OpComponents['schemas']['assetOrder']): Leg | undefined => {
  if (!order) {
    return undefined;
  }
  return legFromAssetOrder(order);
};

const legFromLoanOrder = (order: OpComponents['schemas']['loanOrder']): Leg => {
  const { term, instruction } = order;
  if (!term) {
    throw new ValidationError('No term in order');
  }
  if (!instruction) {
    throw new ValidationError('No instruction in order');
  }
  let leg: Leg = {
    asset: assetFromAPI(term.asset),
    amount: term.amount,
    organizationId: '',
  };

  const { borrowerAccount, lenderAccount } = instruction;
  if (borrowerAccount) {
    const { account } = borrowerAccount;
    if (account.type === 'finId') {
      const { finId, orgId } = account;
      leg.source = {
        profileId: '',
        role: Role.Unknown,
        finId,
        orgId: orgId ? orgId : '',
      };
      leg.organizationId = orgId ? orgId : '';
    }
  }
  if (lenderAccount) {
    const { account } = lenderAccount;
    if (account.type === 'finId') {
      const { finId, orgId } = account;
      leg.destination = {
        profileId: '',
        role: Role.Unknown,
        finId,
        orgId: orgId ? orgId : '',
      };
      leg.organizationId = orgId ? orgId : '';
    }
  }

  return leg;
};

const legFromLoanOrderOpt = (order?: OpComponents['schemas']['loanOrder']): Leg | undefined => {
  if (!order) {
    return undefined;
  }
  return legFromLoanOrder(order);
};


export const executionFromAPI = (plan: OpComponents['schemas']['executionPlan']): ExecutionPlan => {
  const {
    id,
    intent: { intent: { type: intentType } },
    contract: { investors, contractDetails },
  } = plan;

  // const buyer = investors?.find(i => i.role === 'buyer')
  // const seller = investors?.find(i => i.role === 'seller')
  // const borrower = investors?.find(i => i.role === 'borrower')
  // const lender = investors?.find(i => i.role === 'lender')
  // const issuer = investors?.find(i => i.role === 'issuer')

  let contract: Contract = {};
  if (contractDetails) {
    switch (contractDetails.type) {
      case 'transfer': {
        const { asset } = contractDetails;
        contract.asset = legFromAssetOrderOpt(asset);
        break;
      }
      case 'issuance': {
        const { asset, settlement } = contractDetails;
        contract.asset = legFromAssetOrderOpt(asset);
        contract.payment = legFromAssetOrderOpt(settlement);
        break;
      }
      case 'buying': {
        const { asset, settlement } = contractDetails;
        contract.asset = legFromAssetOrderOpt(asset);
        contract.payment = legFromAssetOrderOpt(settlement);
        break;
      }
      case 'selling': {
        const { asset, settlement } = contractDetails;
        contract.asset = legFromAssetOrderOpt(asset);
        contract.payment = legFromAssetOrderOpt(settlement);
        break;
      }
      case 'loan': {
        const { asset, settlement } = contractDetails;
        contract.asset = legFromLoanOrderOpt(asset);
        contract.payment = legFromLoanOrderOpt(settlement);
        break;
      }
      case 'redeem': {
        const { asset, settlement } = contractDetails;
        contract.asset = legFromAssetOrderOpt(asset);
        contract.payment = legFromAssetOrderOpt(settlement);
        break;
      }
      case 'privateOffer': {
        const { asset, settlement } = contractDetails;
        contract.asset = legFromAssetOrderOpt(asset);
        contract.payment = legFromAssetOrderOpt(settlement);
        break;
      }
      case 'requestForTransfer': {
        const { asset } = contractDetails;
        contract.asset = legFromAssetOrderOpt(asset);
        break;
      }
    }
  }

  return {
    id, intentType, contract,
  };
};
