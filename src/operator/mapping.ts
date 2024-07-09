

export const extractAssetId = (asset: OpComponents.Schemas.Asset): string => {
  if (asset.code && asset.code.code) {
    return asset.code.code;
  } else if (asset.resourceId && asset.resourceId.resourceId) {
    return asset.resourceId.resourceId;
  } else {
    throw new Error('No asset code or resourceId found');
  }

};