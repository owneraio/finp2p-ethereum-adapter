import { OssClient } from './oss.client';
import ReceiptOperationErrorInformation = Components.Schemas.ReceiptOperationErrorInformation;
import RegulationError = Components.Schemas.RegulationError;
import { logger } from '../helpers/logger';
import console from 'console';

const RegError = 1;

export class RegulationChecker {
  ossClient: OssClient;

  constructor(ossClient: OssClient) {
    this.ossClient = ossClient;
  }

  async doRegulationCheck(finId: string, assetId: string): Promise<ReceiptOperationErrorInformation | undefined> {
    try {
      
      const owner = await this.ossClient.getOwnerByFinId(finId);
      const asset = await this.ossClient.getAsset(assetId);
      let regulationErrorDetails: RegulationError[] = [];
      for (let reg of asset.regulationVerifiers) {
        if (reg.name === '') {
          continue;
        }
        console.log('Checking regulation', reg.name);
        if (owner.certificates) {
          const found = owner.certificates.nodes.find(c => c.type.toLowerCase() === reg.name.toLowerCase());
          if (!found) {
            regulationErrorDetails.push({
              regulationType: reg.name,
              details: `Investor ${finId} is not certified`,
            } as RegulationError);
          } else {
            console.log('Found certificate', found);
          }
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
    } catch (e) {
      logger.error(`Error checking regulation: ${e}`);
      throw new Error(`Error checking regulation: ${e}`);
    }
  }
}