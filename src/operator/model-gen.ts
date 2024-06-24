declare namespace OpComponents {
  namespace Schemas {
    export interface Asset {
      type: string;
      resourceId: FinP2PAsset;
      code: CurrencyCode;
    }
    export interface CurrencyCode {
      code: string;
    }
    export interface FinP2PAsset {
      resourceId: string;
    }
    export interface OperationResult {
      isCompleted: boolean;
      cid: string | null;
    }
    export interface SetBalanceRequest {
      to: Source;
      asset: Asset;
      balance: string;
      operationId?: string;
    }
    export interface Source {
      finId: string;
    }
  }
}
declare namespace OpPaths {
  namespace OperatorSetBalance {
    namespace Post {
      export type RequestBody = OpComponents.Schemas.SetBalanceRequest;
      namespace Responses {
        export type $200 = OpComponents.Schemas.OperationResult;
      }
    }
  }
}
