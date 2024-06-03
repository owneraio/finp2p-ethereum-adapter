

export const extractAssetId = (asset: OpComponents.Schemas.Asset): string => {
  if (asset.code.code !== '') {
    return asset.code.code;
  } else if (asset.resourceId.resourceId !== '') {
    return asset.resourceId.resourceId;
  } else {
    throw new Error('No asset code or resourceId found');
  }
  // switch (asset.type) {
  //   case 'fiat':
  //     return asset.code.code;
  //   case 'finp2p':
  //     return asset.resourceId.resourceId;
  //   case 'cryptocurrency':
  //     return asset.code.code;
  //   default:
  //     throw new Error(`Unknown asset type ${asset.type}`);
  // }
};