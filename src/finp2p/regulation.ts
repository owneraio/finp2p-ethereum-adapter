import { OssClient } from './oss.client';
import ReceiptOperationErrorInformation = Components.Schemas.ReceiptOperationErrorInformation;
import RegulationError = Components.Schemas.RegulationError;

const RegError = 1;

export class RegulationChecker {
  ossClient: OssClient;

  constructor(ossClient: OssClient) {
    this.ossClient = ossClient;
  }

  async doRegulationCheck(finId: string, assetId: string): Promise<ReceiptOperationErrorInformation | undefined>  {
    const owner = await this.ossClient.getOwnerByFinId(finId);
    const asset = await this.ossClient.getAsset(assetId);
    let regulationErrorDetails: RegulationError[] = [];
    for (let reg of asset.regulationVerifiers) {
      if (reg.name === '') {
        continue;
      }
      if (!owner.certificates.nodes.find(c => c.type === reg.name)) {
        regulationErrorDetails.push({
          regulationType: reg.name,
          details: `Investor ${finId} is not certified`,
        } as RegulationError);
      }
    }
    if (regulationErrorDetails.length > 0) {
      return  {
        code: RegError,
        message: 'Execution Failed',
        regulationErrorDetails,
      } as ReceiptOperationErrorInformation;
    }
    return undefined;
  }
}