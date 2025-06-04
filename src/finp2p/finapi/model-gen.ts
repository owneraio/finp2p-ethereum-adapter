declare namespace FinAPIComponents {
    namespace Schemas {
        export interface AbsolutePollingInterval {
            type: "absolute";
            /**
             * absolute time as epoch time seconds
             */
            time: number;
        }
        export type Account = FinIdAccount | CryptoWalletAccount | IbanAccount;
        /**
         * describes account information
         */
        export interface AccountAsset {
            account: Account;
            asset: Asset;
        }
        export type AccountOperation = {
            /**
             * unique correlation id which identify the operation
             */
            cid?: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            type: "account";
            metadata?: any;
        } & (ApiAnyError | AccountOperationResultResponse);
        export interface AccountOperationResult {
            /**
             * custodian org id
             */
            custodyOrgId?: string;
            /**
             * hex representation of a secp256k1 resource public key 33 bytes compressed
             */
            finId?: string;
        }
        export interface AccountOperationResultResponse {
            type: "response";
            response?: AccountOperationResult;
        }
        export type AccountRequestForTransfer = FinIdAccount;
        /**
         * the total number of units
         */
        export type Amount = string; // ^\d+\.?\d*$
        export type ApiAnyError = ApiErrorClient4XX | ApiErrorServer5XX;
        export interface ApiErrorClient4XX {
            type: "error";
            status: 400 | 401 | 403 | 404 | 409;
            errors: (AssetMetadataAndConfigError | GeneralClientError)[];
        }
        export interface ApiErrorServer5XX {
            type: "error";
            status: 500 | 502 | 503 | 504;
            errors: GeneralServerError[];
        }
        export interface ApproveExecutionPlanRequest {
            /**
             * execution plan information
             */
            executionPlan: {
                /**
                 * execution plan id
                 */
                id: string;
            };
        }
        export interface ApproveExecutionPlanResponse {
            /**
             * unique correlation id which identify the operation
             */
            cid: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            operationMetadata?: /* additional metadata regarding the operation */ OperationMetadata;
            approval: PlanApproved | PlanRejected;
        }
        export type Asset = CryptocurrencyAsset | FiatAsset | Finp2pAsset;
        export interface AssetDenomination {
            /**
             * denomination asset type
             */
            type: "fiat" | "cryptocurrency";
            /**
             * unique code identifying the denomination asset type
             */
            code: string; // ^[a-zA-Z0-9]*$
        }
        /**
         * The Asset resource id
         * example:
         * bank-x:102:f461a964-ae08-4e35-b690-24de06d973db
         */
        export type AssetId = string; // ^[^:](?:.+):102:(?:.+)
        export interface AssetInstruction {
            account: AssetInstructionAccount;
            asset: Finp2pAsset;
        }
        export type AssetInstructionAccount = FinIdAccount;
        export interface AssetIssuer {
            type: "assetIssuer";
            issuerId: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            assetId: /**
             * The Asset resource id
             * example:
             * bank-x:102:f461a964-ae08-4e35-b690-24de06d973db
             */
            AssetId /* ^[^:](?:.+):102:(?:.+) */;
        }
        export interface AssetMetadataAndConfigError {
            code: 4108;
            message: "Asset metadata and config cannot be provided at the same time";
        }
        export interface AssetPolicies {
            proof?: ProofPolicy;
        }
        export interface AssetTerm {
            asset: Asset;
            amount: /* the total number of units */ Amount /* ^\d+\.?\d*$ */;
        }
        export interface AssetVerifier {
            /**
             * verifier id
             */
            id: string; // ^[a-zA-Z0-9]*$
            name: /* The name of the asset */ Name /* ^[a-zA-Z0-9\-_. /]*$ */;
            /**
             * one from the list [REG_APP_STORE, OTHER]
             */
            provider: "REG_APP_STORE" | "OTHER";
        }
        export interface BalanceInformation {
            /**
             * the asset token balance quantity
             */
            quantity: string;
        }
        /**
         * Asset Hash Group (AHG) structure:
         *
         * AHG = hash('SHA3-256', [fields by order]);
         *
         * | order | value | type | comment |
         * |--|--|--|--|
         * | 1 | nonce           | []byte  |  |
         * | 2 | operation       | string  | "transfer" |
         * | 3 | assetType       | string  | "finp2p" |
         * | 4 | assetId         | string  | unique identifier of the asset |
         * | 5 | srcAccountType  | string  | "finId" |
         * | 6 | srcAccount      | string  | source account finId address  |
         * | 7 | dstAccountType  | string  | "finId" |
         * | 8 | dstAccount      | string  | destination account finId address  |
         * | 9 | amount          | string  | string representation of the transfer amount |
         *
         * Settlement Hash Group (SHG) structure:
         *
         * SHG = hash('SHA3-256', [fields by order]);
         *
         * | order | value | type | comment |
         * |--|--|--|--|
         * | 1 | assetType       | string  | "finp2p", "fiat", "cryptocurrency" |
         * | 2 | assetId         | string  | unique identifier of the asset |
         * | 3 | srcAccountType  | string  | "finId", "cryptoWallet", "escrow" |
         * | 4 | srcAccount      | string  | source account of the asset  |
         * | 5 | dstAccountType  | string  | "finId", "cryptoWallet", "escrow" |
         * | 6 | dstAccount      | string  | destination account for the asset  |
         * | 7 | amount          | string  | string representation of the settlement amount |
         * | 8 | expiry          | string  | string representation of the escrow hold expiry value |
         *
         * hashGroups = hash('SHA3-256', [AHG, SHG]);
         *
         * Signature = sign(sender private secp256k1 key, hashGroups)
         *
         */
        export type BuyerTransferSignature = string;
        export interface BuyingIntent {
            type: "buyingIntent";
            /**
             * resource id of the buyer
             */
            buyer: string;
            assetTerm: Finp2pAssetTerm;
            assetInstruction: IntentAssetInstruction;
            settlementTerm?: SettlementTerm;
            settlementInstruction: BuyingIntentSettlementInstruction;
            signaturePolicy?: PresignedBuyIntentSignaturePolicy | ManualSignaturePolicy;
        }
        export interface BuyingIntentAssetTermUpdate {
            amount: /* the total number of units */ Amount /* ^\d+\.?\d*$ */;
        }
        export interface BuyingIntentExecution {
            type: "buyingIntentExecution";
            nonce: /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            Nonce;
            asset: TransferRequestAssetOrder;
            settlement: /* Settlement information for the execute intent request */ ExecuteIntentRequestSettlement;
            seller: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
        }
        export interface BuyingIntentSettlementInstruction {
            sourceAccount: /* describes account information */ AccountAsset;
        }
        export interface BuyingIntentSettlementTermUpdate {
            unitValue: /* A unit value represented as a string, the value is a decimal number */ UnitValue /* ^\d+(\.\d+)?$ */;
        }
        /**
         * allowed fields to be updated on given intent type
         */
        export interface BuyingIntentUpdatePayload {
            type: "buyingIntent";
            settlementTerm?: BuyingIntentSettlementTermUpdate;
            assetTerm?: BuyingIntentAssetTermUpdate;
        }
        export interface CallbackEndpoint {
            type: "endpoint";
        }
        export interface CallbackResultsStrategy {
            type: "callback";
            callback: CallbackEndpoint;
        }
        export interface CloseAmountTerm {
            type: "closeAmountTerm";
            closeAmount: /* the total number of units */ Amount /* ^\d+\.?\d*$ */;
        }
        export type Correspondent = AssetIssuer;
        export interface CryptoTransfer {
            type: "cryptoTransfer";
            network: string;
            contractAddress: string;
            walletAddress: string;
        }
        export interface CryptoWalletAccount {
            type: "cryptoWallet";
            /**
             * address of the cryptocurrency wallet
             */
            address: string; // ^0x[0-9a-hA-H]+$
        }
        export interface CryptocurrencyAsset {
            type: "cryptocurrency";
            /**
             * unique identifier symbol of the cryptocurrency
             */
            code: string; // ^[0-9a-zA-Z_\-]+$
        }
        export interface Custodian {
            orgId: string;
        }
        export interface CustomAsset {
            type: "custom";
        }
        /**
         * describes account information
         */
        export interface DepositAccount {
            account: FinIdAccount;
            asset: DepositAsset;
        }
        export type DepositAsset = CryptocurrencyAsset | FiatAsset | Finp2pAsset | CustomAsset;
        export interface DepositInstruction {
            /**
             * operation id
             */
            operationId: string;
            /**
             * Deposit instruction, including account details
             */
            depositInstruction: {
                account: /* describes account information */ DepositAccount;
                /**
                 * Instruction details
                 */
                description: string;
                /**
                 * Additional details
                 */
                details?: {
                    [key: string]: any;
                };
                paymentOptions?: PaymentMethods;
            };
        }
        export interface DepositInstructionResponse {
            type: "response";
            response?: DepositInstruction;
        }
        export type DepositOperation = {
            /**
             * unique correlation id which identify the operation
             */
            cid?: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            type: "deposit";
        } & (ApiAnyError | DepositInstructionResponse);
        /**
         * HG = hash('SHA3-256', [fields by order]);
         * | order | value | type | comment |
         * |--|--|--|--|
         * | 1 | nonce           | []byte  |  |
         * | 2 | operation       | string  | "deposit" |
         * | 3 | assetType       | string  | "fiat", "cryptocurrency", "custom" |
         * | 4 | assetId         | string  | unique identifier of the asset |
         * | 5 | dstAccountType  | string  | "finId" |
         * | 6 | dstAccount      | string  | destination account to deposit funds  |
         * | 7 | amount          | string  | string representation of the deposit amount |
         *
         * hashGroups = hash('SHA3-256', [HG]);
         *
         * Signature = sign(sender private secp256k1 key, hashGroups)
         *
         */
        export type DepositSignature = string;
        export type DepositSignaturePolicy = ManualSignaturePolicy;
        export interface DocumentRef {
            /**
             * the ID of the document
             */
            id: string;
            /**
             * the URI to retrieve the document
             */
            uri: string;
            /**
             * The file name
             */
            fileName: string;
            /**
             * The file mimeType
             */
            mimeType: string;
        }
        export interface DocumentsList {
            /**
             * A list document references
             */
            refs: DocumentRef[];
        }
        /**
         * Settlement information for the execute intent request
         */
        export interface ExecuteIntentRequestSettlement {
            term: AssetTerm;
            instruction: SettlementInstruction;
        }
        /**
         * Settlement information for the execute intent request
         */
        export interface ExecuteLoanIntentRequestSettlement {
            term: AssetTerm;
            instruction: LoanSettlementInstruction;
        }
        export type ExecutionOperation = {
            /**
             * unique correlation id which identify the operation
             */
            cid?: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            type: "execution";
            metadata?: any;
        } & (ApiAnyError | ExecutionOperationResultResponse);
        export interface ExecutionOperationResult {
            executionPlanId: /**
             * The execution resource id
             * example:
             * bank-x:106:9929ccaf-8967-4ba3-9198-a4b8e3128388
             */
            ExecutionPlanId /* ^[^:](?:.+):106:(?:.+)$ */;
        }
        export interface ExecutionOperationResultResponse {
            type: "response";
            response?: ExecutionOperationResult;
        }
        export interface ExecutionPlanApprovalOperation {
            /**
             * unique correlation id which identify the operation
             */
            cid: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            operationMetadata?: /* additional metadata regarding the operation */ OperationMetadata;
            approval: PlanApproved | PlanRejected;
        }
        /**
         * The execution resource id
         * example:
         * bank-x:106:9929ccaf-8967-4ba3-9198-a4b8e3128388
         */
        export type ExecutionPlanId = string; // ^[^:](?:.+):106:(?:.+)$
        export interface FiatAsset {
            type: "fiat";
            /**
             * unique identifier code of the fiat currency - based on ISO-4217
             */
            code: string; // ^(?:AED|AFN|ALL|AMD|ANG|AOA|ARS|AUD|AWG|AZN|BAM|BBD|BDT|BGN|BHD|BIF|BMD|BND|BOB|BRL|BSD|BTN|BWP|BYR|BZD|CAD|CDF|CHF|CLP|CNY|COP|CRC|CUC|CUP|CVE|CZK|DJF|DKK|DOP|DZD|EGP|ERN|ETB|EUR|FJD|FKP|GBP|GEL|GGP|GHS|GIP|GMD|GNF|GTQ|GYD|HKD|HNL|HRK|HTG|HUF|IDR|ILS|IMP|INR|IQD|IRR|ISK|JEP|JMD|JOD|JPY|KES|KGS|KHR|KMF|KPW|KRW|KWD|KYD|KZT|LAK|LBP|LKR|LRD|LSL|LYD|MAD|MDL|MGA|MKD|MMK|MNT|MOP|MRO|MUR|MVR|MWK|MXN|MYR|MZN|NAD|NGN|NIO|NOK|NPR|NZD|OMR|PAB|PEN|PGK|PHP|PKR|PLN|PYG|QAR|RON|RSD|RUB|RWF|SAR|SBD|SCR|SDG|SEK|SGD|SHP|SLL|SOS|SPL|SRD|STD|SVC|SYP|SZL|THB|TJS|TMT|TND|TOP|TRY|TTD|TVD|TWD|TZS|UAH|UGX|USD|UYU|UZS|VEF|VND|VUV|WST|XAF|XCD|XDR|XOF|XPF|YER|ZAR|ZMW|ZWD)$
        }
        /**
         * describing a field in the hash group
         */
        export interface Field {
            /**
             * name of field
             */
            name?: string;
            /**
             * type of field
             */
            type?: "string" | "int";
            /**
             * hex representation of the field value
             */
            value?: string;
        }
        /**
         * Existing owner hex representation of a secp256k1 public key 33 bytes compressed
         */
        export type FinId = string; // ^[0-9a-h]*$
        export interface FinIdAccount {
            type: "finId";
            finId: /* Existing owner hex representation of a secp256k1 public key 33 bytes compressed */ FinId /* ^[0-9a-h]*$ */;
            orgId: string; // ^[^:]*$
            custodian?: Custodian;
        }
        export interface Finp2pAsset {
            type: "finp2p";
            /**
             * unique resource ID of the FinP2P asset
             */
            resourceId: string; // ^[^:](?:.+):102:(?:.+)
        }
        export interface Finp2pAssetTerm {
            asset: Finp2pAsset;
            amount: /* the total number of units */ Amount /* ^\d+\.?\d*$ */;
        }
        export interface GeneralClientError {
            code: 1000;
            message: "General client error";
        }
        export interface GeneralServerError {
            code: 2000;
            message: "General server error";
        }
        export interface HashGroup {
            /**
             * hex representation of the hash group hash value
             */
            hash?: string;
            /**
             * list of fields by order they appear in the hash group
             */
            fields?: /* describing a field in the hash group */ Field[];
        }
        export interface IbanAccount {
            type: "iban";
            /**
             * iban address
             * example:
             * GB29NWBK60161331926819
             */
            code: string;
        }
        export interface IbanAccountDetails {
            type: "iban";
            iban: string;
        }
        export interface IdResponse {
            id: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
        }
        /**
         * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
         *
         *   const nonce = Buffer.alloc(32);
         *   nonce.fill(crypto.randomBytes(24), 0, 24);
         *
         *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
         *   const t = BigInt(nowEpochSeconds);
         *   nonce.writeBigInt64BE(t, 24);
         *
         */
        export type IdempotencyKey = string;
        export type Intent = PrimarySale | BuyingIntent | SellingIntent | LoanIntent | RedemptionIntent | PrivateOfferIntent;
        export interface IntentAssetInstruction {
            account: AssetInstruction;
        }
        export type IntentExecution = PrimarySaleExecution | BuyingIntentExecution | SellingIntentExecution | LoanIntentExecution | RedemptionIntentExecution | PrivateOfferIntentExecution;
        /**
         * The intent resource id
         * example:
         * bank-x:105:9929ccaf-8967-4ba3-9198-a4b8e3128388
         */
        export type IntentId = string; // ^[^:](?:.+):105:(?:.+)
        export interface IntentIdResponse {
            intentId: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
        }
        export interface IntentInfo {
            /**
             * The type of the intent.
             */
            type: "requestForTransferIntent";
            /**
             * The amount of the asset, fiat or cryptocurrency to be transferred.
             * example:
             * 100
             */
            amount: string;
            asset: Asset;
        }
        export type IntentType = "primarySale" | "buyingIntent" | "sellingIntent" | "loanIntent" | "redemptionIntent" | "privateOfferIntent" | "requestForTransferIntent";
        /**
         * Allowed intent types to be applied on an asset
         */
        export type IntentTypes = [
            IntentType,
            ...IntentType[]
        ];
        /**
         * Allowed intent types to be applied on an asset
         */
        export type IntentTypesAllowEmpty = IntentType[];
        export interface InterestTerm {
            type: "interestTerm";
            /**
             * indicative annual interest rate of the operation
             */
            interestRate: string;
        }
        export interface IssueRequestAssetOrder {
            term: Finp2pAssetTerm;
            instruction: IssueRequestAssetOrderInstruction;
        }
        export interface IssueRequestAssetOrderInstruction {
            destinationAccount: AssetInstruction;
        }
        /**
         *
         * Asset Hash Group (AHG) structure:
         *
         * AHG = hash('SHA3-256', [fields by order]);
         *
         * | order | value | type | comment |
         * |--|--|--|--|
         * | 1 | nonce           | []byte  |  |
         * | 2 | operation       | string  | "issue" |
         * | 3 | assetType       | string  | "finp2p" |
         * | 4 | assetId         | string  | unique identifier of the asset |
         * | 5 | dstAccountType  | string  | "finId" |
         * | 6 | dstAccount      | string  | destination account finId address hex representation |
         * | 7 | amount          | string  | hex (prefixed with 0x) representation of the issuance amount |
         *
         * Settlement Hash Group (SHG) structure:
         *
         * SHG = hash('SHA3-256', [fields by order]);
         *
         * | order | value | type | comment |
         * |--|--|--|--|
         * | 1 | assetType       | string  | "finp2p", "fiat", "cryptocurrency" |
         * | 2 | assetId         | string  | unique identifier of the asset |
         * | 3 | srcAccountType  | string  | "finId", "cryptoWallet", "escrow" |
         * | 4 | srcAccount      | string  | source account of the asset  |
         * | 5 | dstAccountType  | string  | "finId", "cryptoWallet", "escrow" |
         * | 6 | dstAccount      | string  | destination account for the asset  |
         * | 7 | amount          | string  | string representation of the settlement amount |
         * | 8 | expiry          | string  | string representation of the escrow hold expiry value |
         *
         * hashGroups = hash('SHA3-256', [AHG, SHG]);
         *
         * Signature = sign(sender private secp256k1 key, hashGroups)
         *
         */
        export type IssueSignature = string;
        export type LedgerAssetBinding = LedgerTokenId;
        export interface LedgerTokenId {
            /**
             * the type of the identifier
             */
            type: "tokenId";
            /**
             * the token id binding
             */
            tokenId: string;
        }
        export type LoanConditions = RepaymentTerm | InterestTerm | CloseAmountTerm;
        export interface LoanInstruction {
            /**
             * date and time operation starts, in epoch (seconds)
             */
            openDate: number; // int64
            /**
             * date and time operation ends, in epoch (seconds)
             */
            closeDate: number; // int64
            conditions: LoanConditions;
        }
        export interface LoanIntent {
            type: "loanIntent";
            creatorType: "borrower" | "lender";
            borrower: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            lender: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            assetTerm?: Finp2pAssetTerm;
            assetInstruction?: LoanIntentAssetInstruction;
            settlementTerm?: SettlementTerm;
            settlementInstruction?: LoanIntentSettlementInstruction;
            loanInstruction?: LoanInstruction;
            signaturePolicy?: PresignedLoanIntentSignaturePolicy;
        }
        export interface LoanIntentAssetInstruction {
            borrowerAccount: AssetInstruction;
            lenderAccount: AssetInstruction;
        }
        export interface LoanIntentAssetTermUpdate {
            amount: /* the total number of units */ Amount /* ^\d+\.?\d*$ */;
        }
        export interface LoanIntentExecution {
            type: "loanIntentExecution";
            executorType: "borrower" | "lender";
            nonce: /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            Nonce;
            borrower: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            lender: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            asset: LoanRequestAssetOrder;
            settlement: /* Settlement information for the execute intent request */ ExecuteLoanIntentRequestSettlement;
            loanInstruction?: LoanInstruction;
        }
        export interface LoanIntentSettlementInstruction {
            borrowerAccount: /* describes account information */ AccountAsset;
            lenderAccount: /* describes account information */ AccountAsset;
        }
        export interface LoanIntentSettlementTermUpdate {
            unitValue: /* A unit value represented as a string, the value is a decimal number */ UnitValue /* ^\d+(\.\d+)?$ */;
        }
        /**
         * allowed fields to be updated on given intent type
         */
        export interface LoanIntentUpdatePayload {
            type: "loanIntent";
            settlementTerm?: LoanIntentSettlementTermUpdate;
            assetTerm?: LoanIntentAssetTermUpdate;
        }
        export interface LoanRequestAssetOrder {
            term: Finp2pAssetTerm;
            instruction: LoanRequestAssetOrderInstruction;
        }
        export interface LoanRequestAssetOrderInstruction {
            borrowerAccount: AssetInstruction;
            lenderAccount: AssetInstruction;
        }
        export interface LoanSettlementInstruction {
            borrowerAccount: /* describes account information */ AccountAsset;
            lenderAccount: /* describes account information */ AccountAsset;
        }
        /**
         * Loan signature:
         *
         * Single Hash Group (AHG) structure:
         *
         * HASH = hash('SHA3-256', [fields by order]);
         *
         * | order | value | type | comment |
         * |---|--|--|--|
         * |  1 | nonce           | []byte  |  |
         * |  2 | operation       | string  | "loan" |
         * |  3 | assetType       | string  | "finp2p" |
         * |  4 | assetId         | string  | unique identifier of the collateral asset |
         * |  5 | srcAccountType  | string  | "finId" |
         * |  6 | srcAccount      | string  | source account finId address  |
         * |  7 | dstAccountType  | string  | "finId" |
         * |  8 | dstAccount      | string  | destination account finId address  |
         * |  9 | amount          | string  | string representation of the transfer amount |
         * | 10 | assetType       | string  | money asset type "finp2p", "fiat", "cryptocurrency" |
         * | 11 | assetId         | string  | unique identifier of the money asset |
         * | 12 | srcAccountType  | string  | source money account type "finId", "cryptoWallet", "escrow" |
         * | 13 | srcAccount      | string  | source money account id  |
         * | 14 | dstAccountType  | string  | destination money account type "finId", "cryptoWallet", "escrow" |
         * | 15 | dstAccount      | string  | destination money account id  |
         * | 16 | amount          | string  | string representation of the money borrowed |
         * | 17 | closeAmount     | string  | string representation of the money returned back |
         * | 18 | openTime        | string  | string representation of the open time volume |
         * | 19 | closeTime       | string  | string representation of the close time volume |
         *
         * hashGroups = hash('SHA3-256', [HASH]);
         *
         * Signature = sign(sender private secp256k1 key, hashGroups)
         *
         */
        export type LoanSignature = string;
        export interface ManualSignaturePolicy {
            type: "manualPolicy";
            nonce?: /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            Nonce;
        }
        export interface MessageResponse {
            id: string;
        }
        /**
         * The name of the asset
         */
        export type Name = string; // ^[a-zA-Z0-9\-_. /]*$
        /**
         * no proof validation required for this policy
         */
        export interface NoProofPolicy {
            type: "noProofPolicy";
        }
        /**
         * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
         *
         *   const nonce = Buffer.alloc(32);
         *   nonce.fill(crypto.randomBytes(24), 0, 24);
         *
         *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
         *   const t = BigInt(nowEpochSeconds);
         *   nonce.writeBigInt64BE(t, 24);
         *
         */
        export type Nonce = string;
        export interface OperationBase {
            /**
             * unique correlation id which identify the operation
             */
            cid: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            operationMetadata?: /* additional metadata regarding the operation */ OperationMetadata;
        }
        /**
         * additional metadata regarding the operation
         */
        export interface OperationMetadata {
            /**
             * denote the expected response strategy of the operation, i.e. how would completion and results of the operation should be handled
             * optional, if not provided [polling strategy](#/components/schema/pollingResultsStrategy) will be use with [random interval](#/components/schema/randomPollingInterval)
             *
             */
            operationResponseStrategy?: /**
             * denote the expected response strategy of the operation, i.e. how would completion and results of the operation should be handled
             * optional, if not provided [polling strategy](#/components/schema/pollingResultsStrategy) will be use with [random interval](#/components/schema/randomPollingInterval)
             *
             */
            PollingResultsStrategy | CallbackResultsStrategy;
        }
        export type OperationResponse = TokenOperation | ProfileOperation | DepositOperation | WithdrawOperation | ExecutionOperation | AccountOperation;
        /**
         * The Owner resource id
         * example:
         * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
         */
        export type OwnerId = string; // ^[^:](?:.+):101:(?:.+)
        export interface PaymentInstructions {
            type: "paymentInstructions";
            instruction: string;
        }
        export interface PaymentMethod {
            description: string;
            /**
             * accepted currency for payment
             */
            currency: string;
            methodInstruction: WireTransfer | WireTransferUSA | CryptoTransfer | PaymentInstructions;
        }
        export type PaymentMethods = PaymentMethod[];
        export interface PlanApprovalResponse {
            approval: PlanApproved | PlanRejected;
        }
        export interface PlanApproved {
            status: "approved";
        }
        export interface PlanRejected {
            status: "rejected";
            failure?: ValidationFailure | RegulationFailure;
        }
        export interface PollingResultsStrategy {
            type: "poll";
            polling: RandomPollingInterval | AbsolutePollingInterval | RelativePollingInterval;
        }
        export interface PreSignedRedemptionIntentSignaturePolicy {
            type: "presignedPolicy";
        }
        export interface PresignedBuyIntentSignaturePolicy {
            type: "presignedPolicy";
        }
        export interface PresignedLoanIntentSignaturePolicy {
            type: "presignedPolicy";
        }
        export interface PresignedPrivateOfferIntentSignaturePolicy {
            type: "presignedPolicy";
        }
        export interface PresignedSellIntentSignaturePolicy {
            type: "presignedPolicy";
        }
        export interface PrimarySale {
            type: "primarySale";
            issuer: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            assetTerm: Finp2pAssetTerm;
            assetInstruction: IntentAssetInstruction;
            settlementTerm: SettlementTerm;
            settlementInstruction?: SellingIntentSettlementInstruction;
        }
        export interface PrimarySaleAssetTermUpdate {
            amount: /* the total number of units */ Amount /* ^\d+\.?\d*$ */;
        }
        export interface PrimarySaleExecution {
            type: "primarySaleExecution";
            nonce: /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            Nonce;
            issuer: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            buyer: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            asset: IssueRequestAssetOrder;
            settlement: /* Settlement information for the execute intent request */ ExecuteIntentRequestSettlement;
        }
        /**
         * allowed fields to be updated on given intent type
         */
        export interface PrimarySaleIntentUpdatePayload {
            type: "primarySale";
            settlementTerm?: PrimarySaleSettlementTermUpdate;
            assetTerm?: PrimarySaleAssetTermUpdate;
        }
        export interface PrimarySaleSettlementTermUpdate {
            unitValue: /* A unit value represented as a string, the value is a decimal number */ UnitValue /* ^\d+(\.\d+)?$ */;
        }
        export interface PrivateOfferAssetInstruction {
            account?: AssetInstructionAccount;
            asset: Finp2pAsset;
        }
        export interface PrivateOfferIntent {
            type: "privateOfferIntent";
            buyer: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            seller: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            assetTerm: Finp2pAssetTerm;
            assetInstruction?: PrivateOfferIntentAssetInstruction;
            settlementTerm: SettlementTerm;
            signaturePolicy?: PresignedSellIntentSignaturePolicy | ManualSignaturePolicy;
            settlementInstruction?: SellingIntentSettlementInstruction;
        }
        export interface PrivateOfferIntentAssetInstruction {
            account: PrivateOfferAssetInstruction;
        }
        export interface PrivateOfferIntentAssetTermUpdate {
            amount: /* the total number of units */ Amount /* ^\d+\.?\d*$ */;
        }
        export interface PrivateOfferIntentExecution {
            type: "privateOfferIntentExecution";
            nonce: /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            Nonce;
            asset: TransferRequestAssetOrder;
            settlement: /* Settlement information for the execute intent request */ ExecuteIntentRequestSettlement;
            buyer: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            seller: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
        }
        export interface PrivateOfferIntentSettlementInstruction {
            sellerAccount: /* describes account information */ AccountAsset;
            buyerAccount: /* describes account information */ AccountAsset;
        }
        export interface PrivateOfferIntentSettlementTermUpdate {
            unitValue: /* A unit value represented as a string, the value is a decimal number */ UnitValue /* ^\d+(\.\d+)?$ */;
        }
        /**
         * allowed fields to be updated on given intent type
         */
        export interface PrivateOfferIntentUpdatePayload {
            type: "privateOfferIntent";
            settlementTerm?: PrivateOfferIntentSettlementTermUpdate;
            assetTerm?: PrivateOfferIntentAssetTermUpdate;
        }
        /**
         * finp2p resource id format
         * example:
         * bank-x:101:9929ccaf-8967-4ba3-9198-a4b8e3128388
         */
        export type ProfileId = string; // ^[^:](?:.+):(101|102):(?:.+)
        export type ProfileOperation = {
            /**
             * unique correlation id which identify the operation
             */
            cid?: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            type: "profile";
        } & (ApiAnyError | ProfileOperationResponse);
        export interface ProfileOperationResponse {
            type: "response";
            response?: ResourceIdResponse;
        }
        export type ProofPolicy = SignatureProofPolicy | /* no proof validation required for this policy */ NoProofPolicy;
        export interface RandomPollingInterval {
            type: "random";
        }
        export interface Receipt {
            /**
             * receipt id
             */
            id: string;
            asset: ReceiptAsset;
            source?: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            destination?: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            quantity: string;
            tradeDetails?: ReceiptTradeDetails;
            details: ReceiptDetails;
            operationRef?: string;
            operationType: "hold" | "issue" | "redeem" | "release" | "transfer" | "unknown";
            timestamp: number;
        }
        export interface ReceiptAsset {
            /**
             * asset code
             */
            code: string;
            /**
             * asset type
             */
            type: string;
        }
        export interface ReceiptAssetDetails {
            type: "asset";
            sourceFinId?: string;
            destinationFinId?: string;
            transactionDetails: /* Additional input and output details for UTXO supporting DLTs */ ReceiptTransactionDetails;
        }
        export type ReceiptDetails = ReceiptAssetDetails | ReceiptPaymentDetails;
        export interface ReceiptExecutionContext {
            executionPlanId: string;
            instructionSequenceNumber: number;
        }
        export interface ReceiptPaymentDetails {
            type: "payment";
            source?: /* describes account information */ AccountAsset;
            destination?: /* describes account information */ AccountAsset;
            transactionDetails: /* Additional input and output details for UTXO supporting DLTs */ ReceiptTransactionDetails;
        }
        export interface ReceiptResponse {
            type: "response";
            receipt?: Receipt;
        }
        export interface ReceiptTradeDetails {
            intentId?: string;
            intentVersion?: string;
            executionContext?: ReceiptExecutionContext;
        }
        /**
         * Additional input and output details for UTXO supporting DLTs
         */
        export interface ReceiptTransactionDetails {
            /**
             * Transaction id
             */
            transactionId: string;
            /**
             * Operation id
             */
            operationId?: string;
        }
        export interface RedemptionIntent {
            type: "redemptionIntent";
            issuer: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            assetTerm: Finp2pAssetTerm;
            assetInstruction?: IntentAssetInstruction;
            settlementTerm?: SettlementTerm;
            settlementInstruction: RedemptionIntentSettlementInstruction;
            conditions?: RedemptionIntentConditions;
            signaturePolicy?: PreSignedRedemptionIntentSignaturePolicy | ManualSignaturePolicy;
        }
        export interface RedemptionIntentAssetTermUpdate {
            amount: /* the total number of units */ Amount /* ^\d+\.?\d*$ */;
        }
        export interface RedemptionIntentConditions {
            /**
             * duration in ISO 8601 format (e.g., "PT1H30M" for 1 hour 30 minutes)
             */
            redemptionDuration?: string; // duration ^P(\d{1}Y)?(\d{1,2}M)?(\d{1,3}D)?(T(\d{1,2}H)?(\d{1,2}M)?(\d{1,2}S)?)?$
        }
        export interface RedemptionIntentExecution {
            type: "redemptionIntentExecution";
            nonce: /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            Nonce;
            issuer: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            seller: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            asset: TransferRequestAssetOrder;
            settlement: /* Settlement information for the execute intent request */ ExecuteIntentRequestSettlement;
        }
        export interface RedemptionIntentSettlementInstruction {
            sourceAccounts: /* describes account information */ AccountAsset[];
        }
        export interface RedemptionIntentSettlementTermUpdate {
            unitValue: /* A unit value represented as a string, the value is a decimal number */ UnitValue /* ^\d+(\.\d+)?$ */;
        }
        /**
         * allowed fields to be updated on given intent type
         */
        export interface RedemptionIntentUpdatePayload {
            type: "redemptionIntent";
            settlementTerm?: RedemptionIntentSettlementTermUpdate;
            assetTerm?: RedemptionIntentAssetTermUpdate;
        }
        export interface RegulationError {
            /**
             * the type of regulation
             */
            regulationType: string;
            /**
             * actionable details of the error
             */
            details: string;
        }
        export interface RegulationFailure {
            failureType: "RegulationFailure";
            errors: RegulationError[];
        }
        export interface RelativePollingInterval {
            type: "relative";
            /**
             * ISO-8601 duration format
             * example:
             * PT5M (5Min duration), P1DT30M (1 Day and 30 Minutes )
             */
            duration: string;
        }
        export interface RepaymentTerm {
            type: "repaymentTerm";
            closeAmount: /* the total number of units */ Amount /* ^\d+\.?\d*$ */;
            /**
             * indicative annual interest rate of the operation
             */
            interestRate?: string; // ^-?\d*\.?\d*$
        }
        export interface RequestForTransferDestinationAccount {
            /**
             * The type of the intent.
             */
            type: "requestForTransferIntent";
            /**
             * The amount of the asset, fiat or cryptocurrency to be transferred.
             * example:
             * 100
             */
            amount: string;
            asset: Asset;
            /**
             * Indicates whether the operation is to send or request money/asset.
             */
            action: "request";
            destinationAccount?: AccountRequestForTransfer;
        }
        export interface RequestForTransferExecuteIntent {
            nonce?: /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            Nonce;
            senderId: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            receiverId: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            /**
             * Indicates whether the operation is to send or request money/asset.
             */
            action: "send" | "request";
            /**
             * The type of the intent.
             */
            type: "requestForTransferIntent";
            /**
             * The amount of the asset, fiat or cryptocurrency to be transferred.
             * example:
             * 100
             */
            amount: string;
            asset: Asset;
            sourceAccount: AccountRequestForTransfer;
            destinationAccount: AccountRequestForTransfer;
            transactionMetadata?: TransactionMetadata;
        }
        export interface RequestForTransferIntent {
            /**
             * start time for intent, in epoch (seconds)
             */
            start: number; // int64
            /**
             * end time for intent, in epoch (seconds)
             */
            end: number; // int64
            nonce?: /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            Nonce;
            senderId: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            receiverId: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            intentInfo: RequestForTransferIntentInfo;
            transactionMetadata?: TransactionMetadata;
        }
        export type RequestForTransferIntentInfo = RequestForTransferSourceAccount | RequestForTransferDestinationAccount;
        export interface RequestForTransferSourceAccount {
            /**
             * The type of the intent.
             */
            type: "requestForTransferIntent";
            /**
             * The amount of the asset, fiat or cryptocurrency to be transferred.
             * example:
             * 100
             */
            amount: string;
            asset: Asset;
            /**
             * Indicates whether the operation is to send or request money/asset.
             */
            action: "send";
            sourceAccount?: AccountRequestForTransfer;
        }
        export interface RequestForTransferUpdateIntent {
            /**
             * start time for intent, in epoch (seconds)
             */
            start?: number; // int64
            /**
             * end time for intent, in epoch (seconds)
             */
            end?: number; // int64
            /**
             * To change the status of the intent
             */
            status?: "Unknown" | "Active" | "NonActive" | "Cancelled" | "Completed" | "Expired" | "Rejected";
            intentInfo?: {
                /**
                 * The amount of the asset, fiat or cryptocurrency to be transferred.
                 * example:
                 * 100
                 */
                amount?: string;
            };
            transactionMetadata?: TransactionMetadata;
        }
        /**
         * finp2p resource id format
         * example:
         * bank-x:101:9929ccaf-8967-4ba3-9198-a4b8e3128388
         */
        export type ResourceId = string; // ^[^:](?:.+):(101|102|103|104|105):(?:.+)
        export interface ResourceIdResponse {
            id: /**
             * finp2p resource id format
             * example:
             * bank-x:101:9929ccaf-8967-4ba3-9198-a4b8e3128388
             */
            ResourceId /* ^[^:](?:.+):(101|102|103|104|105):(?:.+) */;
        }
        /**
         * Asset Hash Group (AHG) structure:
         *
         * AHG = hash('SHA3-256', [fields by order]);
         *
         * | order | value | type | comment |
         * |--|--|--|--|
         * | 1 | nonce           | []byte  |  |
         * | 2 | operation       | string  | "transfer" |
         * | 3 | assetType       | string  | "finp2p" |
         * | 4 | assetId         | string  | unique identifier of the asset |
         * | 5 | srcAccountType  | string  | "finId" |
         * | 6 | srcAccount      | string  | source account finId address  |
         * | 7 | dstAccountType  | string  | "finId" |
         * | 8 | dstAccount      | string  | destination account finId address  |
         * | 9 | amount          | string  | string representation of the transfer amount |
         *
         * Settlement Hash Group (SHG) structure:
         *
         * SHG = hash('SHA3-256', [fields by order]);
         *
         * | order | value | type | comment |
         * |--|--|--|--|
         * | 1 | assetType       | string  | "finp2p", "fiat", "cryptocurrency" |
         * | 2 | assetId         | string  | unique identifier of the asset |
         * | 3 | srcAccountType  | string  | "finId", "cryptoWallet", "escrow" |
         * | 4 | srcAccount      | string  | source account of the asset  |
         * | 5 | dstAccountType  | string  | "finId", "cryptoWallet", "escrow" |
         * | 6 | dstAccount      | string  | destination account for the asset  |
         * | 7 | amount          | string  | string representation of the settlement amount |
         *
         * hashGroups = hash('SHA3-256', [AHG, SHG]);
         *
         * Signature = sign(sender private secp256k1 key, hashGroups)
         *
         */
        export type SellerTransferSignature = string;
        export interface SellingIntent {
            type: "sellingIntent";
            seller: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            assetTerm: Finp2pAssetTerm;
            assetInstruction: IntentAssetInstruction;
            settlementTerm: SettlementTerm;
            signaturePolicy?: PresignedSellIntentSignaturePolicy | ManualSignaturePolicy;
            settlementInstruction?: SellingIntentSettlementInstruction;
        }
        export interface SellingIntentAssetTermUpdate {
            amount: /* the total number of units */ Amount /* ^\d+\.?\d*$ */;
        }
        export interface SellingIntentExecution {
            type: "sellingIntentExecution";
            nonce: /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            Nonce;
            asset: TransferRequestAssetOrder;
            settlement: /* Settlement information for the execute intent request */ ExecuteIntentRequestSettlement;
            buyer: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
        }
        export interface SellingIntentSettlementInstruction {
            destinationAccounts: /* describes account information */ AccountAsset[];
        }
        export interface SellingIntentSettlementTermUpdate {
            unitValue: /* A unit value represented as a string, the value is a decimal number */ UnitValue /* ^\d+(\.\d+)?$ */;
        }
        /**
         * allowed fields to be updated on given intent type
         */
        export interface SellingIntentUpdatePayload {
            type: "sellingIntent";
            settlementTerm?: SellingIntentSettlementTermUpdate;
            assetTerm?: SellingIntentAssetTermUpdate;
        }
        export interface SettlementInstruction {
            sourceAccount: /* describes account information */ AccountAsset;
            destinationAccount: /* describes account information */ AccountAsset;
        }
        export interface SettlementTerm {
            asset: Asset;
            /**
             * A unit value represented as a string, the value is a decimal number
             */
            unitValue: string; // ^\d+\.?\d*$
        }
        export interface SignatureProofPolicy {
            type: string;
            policy: {
                /**
                 * The public key used for receipt proof in hex representation of a secp256k1 public key 33 bytes compressed
                 * example:
                 * 0234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12
                 */
                publicKey?: string;
                signatureTemplate?: "hashlist" | "EIP712";
            };
        }
        /**
         * Type of response, immediate / synchronous response or asynchronous
         */
        export type SignatureResponseType = "signature" | "acknowledgement";
        export interface SignatureResultResponse {
            /**
             * Nonce
             */
            nonce?: string;
        }
        /**
         * represent a signature template information
         */
        export interface SignatureTemplate {
            /**
             * hex representation of the signature
             */
            signature?: string;
            /**
             * ordered list of hash groups
             */
            template?: {
                hashGroups?: HashGroup[];
                /**
                 * hex representation of the combined hash groups hash value
                 */
                hash?: string;
            };
        }
        export interface SwiftAccountDetails {
            type: "bic";
            swiftCode: string;
            accountNumber: string;
        }
        export type TokenOperation = {
            /**
             * unique correlation id which identify the operation
             */
            cid?: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            type: "token";
            metadata?: any;
        } & (ApiAnyError | TokenOperationResultResponse);
        export interface TokenOperationResult {
            receipt: Receipt;
        }
        export interface TokenOperationResultResponse {
            type: "response";
            response?: TokenOperationResult;
        }
        export interface TransactionMetadata {
            /**
             * Optional reference ID for the transaction.
             * example:
             * ref-2024-003
             */
            referenceId?: string;
            /**
             * Optional description or note for the transfer.
             * example:
             * Transfer of funds for invoice
             */
            description?: string;
        }
        export interface TransferRequestAssetOrder {
            term: Finp2pAssetTerm;
            instruction: TransferRequestAssetOrderInstruction;
        }
        export interface TransferRequestAssetOrderInstruction {
            sourceAccount: AssetInstruction;
            destinationAccount: AssetInstruction;
        }
        /**
         *
         * Asset Hash Group (AHG) structure:
         *
         * AHG = hash('SHA3-256', [fields by order]);
         *
         * | order | value | type | comment |
         * |--|--|--|--|
         * | 1 | nonce           | []byte  |  |
         * | 2 | operation       | string  | "transfer" |
         * | 3 | assetType       | string  | "finp2p" |
         * | 4 | assetId         | string  | unique identifier of the asset |
         * | 5 | srcAccountType  | string  | "finId" |
         * | 6 | srcAccount      | string  | source account finId address  |
         * | 7 | dstAccountType  | string  | "finId" |
         * | 8 | dstAccount      | string  | destination account finId address  |
         * | 9 | amount          | string  | string representation of the transfer amount |
         *
         * hashGroups = hash('SHA3-256', [AHG]);
         *
         * Signature = sign(sender private secp256k1 key, hashGroups)
         *
         */
        export type TransferSignature = string;
        /**
         *
         * Asset Hash Group (AHG) structure:
         *
         * AHG = hash('SHA3-256', [fields by order]);
         *
         * | order | value | type | comment |
         * |--|--|--|--|
         * | 1 | nonce           | []byte  |  |
         * | 2 | operation       | string  | "transfer" |
         * | 3 | assetType       | string  | "finp2p" |
         * | 4 | assetId         | string  | unique identifier of the asset |
         * | 5 | srcAccountType  | string  | "finId" |
         * | 6 | srcAccount      | string  | source account finId address  |
         * | 7 | dstAccountType  | string  | "finId" |
         * | 8 | dstAccount      | string  | destination account finId address  |
         * | 9 | amount          | string  | string representation of the transfer amount |
         *
         * Settlement Hash Group (SHG) structure:
         *
         * SHG = hash('SHA3-256', [fields by order]);
         *
         * | order | value | type | comment |
         * |--|--|--|--|
         * | 1 | assetType       | string  | "finp2p", "fiat", "cryptocurrency" |
         * | 2 | assetId         | string  | unique identifier of the asset |
         * | 3 | srcAccountType  | string  | "finId", "cryptoWallet", "escrow" |
         * | 4 | srcAccount      | string  | source account of the asset  |
         * | 5 | dstAccountType  | string  | "finId", "cryptoWallet", "escrow" |
         * | 6 | dstAccount      | string  | destination account for the asset  |
         * | 7 | amount          | string  | string representation of the settlement amount |
         *
         * hashGroups = hash('SHA3-256', [AHG, SHG]);
         *
         * Signature = sign(sender private secp256k1 key, hashGroups)
         *
         */
        export type TransferWithSettlementSignature = string;
        /**
         * A unit value represented as a string, the value is a decimal number
         */
        export type UnitValue = string; // ^\d+(\.\d+)?$
        export type UpdateIntent = /* allowed fields to be updated on given intent type */ PrimarySaleIntentUpdatePayload | /* allowed fields to be updated on given intent type */ BuyingIntentUpdatePayload | /* allowed fields to be updated on given intent type */ SellingIntentUpdatePayload | /* allowed fields to be updated on given intent type */ LoanIntentUpdatePayload | /* allowed fields to be updated on given intent type */ RedemptionIntentUpdatePayload | /* allowed fields to be updated on given intent type */ PrivateOfferIntentUpdatePayload;
        export interface ValidationFailure {
            failureType: "ValidationFailure";
            /**
             * ledger error code for validation
             */
            code: number; // uint32
            message: string;
        }
        /**
         * Signature = sign(sender private secp256k1 key, message)
         *
         * | order | value | type | comment |
         * |--|--|--|--|
         * | 1 | nonce | []byte |  |
         * | 2 | operation       | string | "transfer" |
         * | 3 | "*" | string | value should indicate any recipient address |
         * | 4 | assetId            | string | |
         * | 5 | quantity           | string | string representation of the quantity |
         * | 6 | settlementAssetId   | string | |
         * | 7 | settlementQuantity  | string | string representation of the quantity |
         * | 8 | settlementExpiry    | string | string representation of the expiry value |
         *
         */
        export type WildcardTransferSignature = string;
        export type WireDetails = IbanAccountDetails | SwiftAccountDetails;
        export interface WireTransfer {
            type: "wireTransfer";
            accountHolderName: string;
            bankName: string;
            wireDetails: WireDetails;
            line1: string;
            city: string;
            postalCode: string;
            country: string;
        }
        export interface WireTransferUSA {
            type: "wireTransferUSA";
            accountNumber: string;
            routingNumber: string;
            line1: string;
            city: string;
            postalCode: string;
            country: string;
            state: string;
        }
        /**
         * describes account information
         */
        export interface WithdrawAccount {
            account: FinIdAccount;
            asset: Asset;
        }
        /**
         * Withdrawal instruction
         */
        export interface WithdrawInstruction {
            account: /* describes account information */ AccountAsset;
            /**
             * Instruction details
             */
            description: string;
        }
        export type WithdrawOperation = {
            /**
             * unique correlation id which identify the operation
             */
            cid?: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            type: "withdraw";
        } & (ApiAnyError | ReceiptResponse);
        /**
         * HG = hash('SHA3-256', [fields by order]);
         *
         * | order | value | type | comment |
         * |--|--|--|--|
         * | 1 | nonce           | []byte  |  |
         * | 2 | operation       | string  | "withdraw" |
         * | 3 | assetType       | string  |  "fiat", "cryptocurrency", "custom" |
         * | 4 | assetId         | string  | unique identifier of the asset |
         * | 5 | srcAccountType  | string  | "finId" |
         * | 6 | srcAccount      | string  | source account to withdraw funds from  |
         * | 7 | dstAccountType  | string  | "finId", "cryptoWallet", "escrow" | optional
         * | 8 | dstAccount      | string  | destination account to deposit funds into  | optional
         * | 9 | amount          | string  | string representation of the amount |
         *
         * hashGroups = hash('SHA3-256', [HG]);
         *
         * Signature = sign(sender private secp256k1 key, hashGroups)
         *
         */
        export type WithdrawSignature = string;
        export type WithdrawSignaturePolicy = ManualSignaturePolicy;
    }
}
declare namespace FinAPIPaths {
    namespace AddAccount {
        export interface HeaderParameters {
            "Idempotency-Key"?: Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
            export type OwnerId = /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            FinAPIComponents.Schemas.OwnerId /* ^[^:](?:.+):101:(?:.+) */;
        }
        export interface PathParameters {
            ownerId: Parameters.OwnerId;
        }
        export interface RequestBody {
            /**
             * Org ID for the custodian of the account
             */
            orgId: string;
        }
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.AccountOperationResult;
            export type $202 = FinAPIComponents.Schemas.OperationBase;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace AddAssetProfileIntent {
        export interface HeaderParameters {
            "Idempotency-Key"?: Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type Id = string; // ^[^:](?:.+):102:(?:.+)
            export type IdempotencyKey = /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
        }
        export interface PathParameters {
            id: Parameters.Id /* ^[^:](?:.+):102:(?:.+) */;
        }
        export interface RequestBody {
            /**
             * start time for intent, in epoch (seconds)
             */
            start: number; // int64
            /**
             * end time for intent, in epoch (seconds)
             */
            end: number; // int64
            intent: FinAPIComponents.Schemas.Intent;
        }
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.IdResponse;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace AddCertificateDoc {
        export interface HeaderParameters {
            "Idempotency-Key"?: Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type CertificateId = string;
            export type IdempotencyKey = /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
            export type ProfileId = /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            FinAPIComponents.Schemas.OwnerId /* ^[^:](?:.+):101:(?:.+) */;
        }
        export interface PathParameters {
            profileId: Parameters.ProfileId;
            certificateId: Parameters.CertificateId;
        }
        /**
         * The request body can contain multiple files as multiple file form fields
         */
        export interface RequestBody {
            /**
             * the document in binary format
             */
            file?: string; // binary
        }
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.DocumentsList;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace Balance {
        export interface RequestBody {
            asset: /**
             * The Asset resource id
             * example:
             * bank-x:102:f461a964-ae08-4e35-b690-24de06d973db
             */
            FinAPIComponents.Schemas.AssetId /* ^[^:](?:.+):102:(?:.+) */;
            /**
             * owner hex representation of a secp256k1 public key 33 bytes compressed
             */
            sourcePublicKey: string;
        }
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.BalanceInformation;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace CreateAssetProfile {
        export interface HeaderParameters {
            "Idempotency-Key"?: Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
        }
        export interface RequestBody {
            /**
             * The asset metadata
             */
            metadata?: {
                [name: string]: any;
            };
            /**
             * The asset configuration, in serilized JSON representation (deprecated, use metadata instead)
             */
            config?: string;
            /**
             * A list of regulation verifiers to execute to validate a transaction
             */
            verifiers?: FinAPIComponents.Schemas.AssetVerifier[];
            intentTypes?: /* Allowed intent types to be applied on an asset */ FinAPIComponents.Schemas.IntentTypesAllowEmpty;
            name: /* The name of the asset */ FinAPIComponents.Schemas.Name /* ^[a-zA-Z0-9\-_. /]*$ */;
            /**
             * The type of the asset
             */
            type: string; // ^[a-zA-Z0-9\- ]*$
            issuerId: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            FinAPIComponents.Schemas.OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            denomination: FinAPIComponents.Schemas.AssetDenomination;
            ledgerAssetBinding?: FinAPIComponents.Schemas.LedgerAssetBinding;
            assetPolicies?: FinAPIComponents.Schemas.AssetPolicies;
        }
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.ResourceIdResponse;
            export type $202 = FinAPIComponents.Schemas.OperationBase;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace CreateCertificate {
        export interface HeaderParameters {
            "Idempotency-Key"?: Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
            export type ProfileId = /**
             * finp2p resource id format
             * example:
             * bank-x:101:9929ccaf-8967-4ba3-9198-a4b8e3128388
             */
            FinAPIComponents.Schemas.ProfileId /* ^[^:](?:.+):(101|102):(?:.+) */;
        }
        export interface PathParameters {
            profileId: Parameters.ProfileId;
        }
        export interface RequestBody {
            /**
             * The type of the Certificate
             */
            type: string; // ^[a-zA-Z0-9 _./]*$
            /**
             * The issuance date of the Certificate in epoch time seconds
             */
            issuanceDate: number; // int64
            /**
             * The expiration date of the Certificate in epoch time seconds
             */
            expirationDate: number; // int64
            /**
             * Serialized data objects that contain one or more properties that are each related to the subject of the Certificate
             */
            data: string;
        }
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.IdResponse;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace CreateDepositRequest {
        export interface HeaderParameters {
            "Idempotency-Key"?: Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
        }
        export interface RequestBody {
            profileId: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            FinAPIComponents.Schemas.OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            account: /* describes account information */ FinAPIComponents.Schemas.DepositAccount;
            amount: /* the total number of units */ FinAPIComponents.Schemas.Amount /* ^\d+\.?\d*$ */;
            /**
             * Any addition deposit specific information
             */
            details?: {
                [key: string]: any;
            };
            nonce?: /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
            signaturePolicy?: FinAPIComponents.Schemas.DepositSignaturePolicy;
        }
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.DepositInstruction;
            export type $202 = FinAPIComponents.Schemas.OperationBase;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace CreateOwnerProfile {
        export interface HeaderParameters {
            "Idempotency-Key"?: Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
        }
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.ResourceIdResponse;
            export type $202 = FinAPIComponents.Schemas.OperationBase;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace CreateRequestForTransferIntent {
        export interface HeaderParameters {
            "Idempotency-Key"?: Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
        }
        export type RequestBody = FinAPIComponents.Schemas.RequestForTransferIntent;
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.IntentIdResponse;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace CreateWithdrawRequest {
        export interface HeaderParameters {
            "Idempotency-Key"?: Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
        }
        export interface RequestBody {
            profileId: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            FinAPIComponents.Schemas.OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            account: /* describes account information */ FinAPIComponents.Schemas.WithdrawAccount;
            amount: /* the total number of units */ FinAPIComponents.Schemas.Amount /* ^\d+\.?\d*$ */;
            withdrawInstruction?: /* Withdrawal instruction */ FinAPIComponents.Schemas.WithdrawInstruction;
            nonce?: /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
            signaturePolicy?: FinAPIComponents.Schemas.WithdrawSignaturePolicy;
        }
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.Receipt;
            export type $202 = FinAPIComponents.Schemas.OperationBase;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace DisableAssetAllowedIntents {
        namespace Parameters {
            /**
             * example:
             * bank-x:103:ed495b49-2ad8-4e44-a294-405d5e24d181
             */
            export type Id = string; // ^[^:](?:.+):(?:.+):(?:.+)
        }
        export interface PathParameters {
            id: /**
             * example:
             * bank-x:103:ed495b49-2ad8-4e44-a294-405d5e24d181
             */
            Parameters.Id /* ^[^:](?:.+):(?:.+):(?:.+) */;
        }
        export interface RequestBody {
            intentTypes: /* Allowed intent types to be applied on an asset */ FinAPIComponents.Schemas.IntentTypes;
        }
        namespace Responses {
            export interface $200 {
            }
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace DisableAssetProfileIntent {
        namespace Parameters {
            export type Id = /**
             * The Asset resource id
             * example:
             * bank-x:102:f461a964-ae08-4e35-b690-24de06d973db
             */
            FinAPIComponents.Schemas.AssetId /* ^[^:](?:.+):102:(?:.+) */;
            export type IntentId = /**
             * The intent resource id
             * example:
             * bank-x:105:9929ccaf-8967-4ba3-9198-a4b8e3128388
             */
            FinAPIComponents.Schemas.IntentId /* ^[^:](?:.+):105:(?:.+) */;
        }
        export interface PathParameters {
            id: Parameters.Id;
            intentId: Parameters.IntentId;
        }
        namespace Responses {
            export interface $200 {
            }
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace EnableAssetAllowedIntents {
        namespace Parameters {
            /**
             * example:
             * bank-x:103:ed495b49-2ad8-4e44-a294-405d5e24d181
             */
            export type Id = string; // ^[^:](?:.+):(?:.+):(?:.+)
        }
        export interface PathParameters {
            id: /**
             * example:
             * bank-x:103:ed495b49-2ad8-4e44-a294-405d5e24d181
             */
            Parameters.Id /* ^[^:](?:.+):(?:.+):(?:.+) */;
        }
        export interface RequestBody {
            intentTypes: /* Allowed intent types to be applied on an asset */ FinAPIComponents.Schemas.IntentTypes;
        }
        namespace Responses {
            export interface $200 {
            }
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace EnableAssetProfileIntent {
        namespace Parameters {
            export type Id = /**
             * The Asset resource id
             * example:
             * bank-x:102:f461a964-ae08-4e35-b690-24de06d973db
             */
            FinAPIComponents.Schemas.AssetId /* ^[^:](?:.+):102:(?:.+) */;
            export type IntentId = /**
             * The intent resource id
             * example:
             * bank-x:105:9929ccaf-8967-4ba3-9198-a4b8e3128388
             */
            FinAPIComponents.Schemas.IntentId /* ^[^:](?:.+):105:(?:.+) */;
        }
        export interface PathParameters {
            id: Parameters.Id;
            intentId: Parameters.IntentId;
        }
        namespace Responses {
            export interface $200 {
            }
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace ExecuteRequestForTransferIntent {
        export interface HeaderParameters {
            "Idempotency-Key"?: Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
            export type IntentId = string; // ^[^:](?:.+):105:(?:.+)
        }
        export interface PathParameters {
            intentId: Parameters.IntentId /* ^[^:](?:.+):105:(?:.+) */;
        }
        export type RequestBody = FinAPIComponents.Schemas.RequestForTransferExecuteIntent;
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.OperationResponse;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace ExecuteToken {
        export interface HeaderParameters {
            "Idempotency-Key"?: Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
        }
        export interface RequestBody {
            user: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            FinAPIComponents.Schemas.OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            intentId: /**
             * The intent resource id
             * example:
             * bank-x:105:9929ccaf-8967-4ba3-9198-a4b8e3128388
             */
            FinAPIComponents.Schemas.IntentId /* ^[^:](?:.+):105:(?:.+) */;
            intent: FinAPIComponents.Schemas.IntentExecution;
            /**
             * unique identifier for the execution, will default to generated UUID if not provided
             */
            executionId?: string;
        }
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.ExecutionOperationResult;
            export type $202 = FinAPIComponents.Schemas.OperationBase;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace GetAttachment {
        namespace Parameters {
            export type Uuid = string;
        }
        export interface PathParameters {
            uuid: Parameters.Uuid;
        }
        namespace Responses {
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace GetDoc {
        namespace Parameters {
            export type Uri = string;
        }
        export interface PathParameters {
            uri: Parameters.Uri;
        }
        namespace Responses {
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace GetOperation {
        namespace Parameters {
            export type Cid = string;
        }
        export interface PathParameters {
            cid: Parameters.Cid;
        }
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.OperationResponse;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace RedeemToken {
        export interface RequestBody {
            asset: /**
             * The Asset resource id
             * example:
             * bank-x:102:f461a964-ae08-4e35-b690-24de06d973db
             */
            FinAPIComponents.Schemas.AssetId /* ^[^:](?:.+):102:(?:.+) */;
            seller: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            FinAPIComponents.Schemas.OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            sourcePublicKey: /* Existing owner hex representation of a secp256k1 public key 33 bytes compressed */ FinAPIComponents.Schemas.FinId /* ^[0-9a-h]*$ */;
            /**
             * How many units of token type to redeem
             */
            quantity: string;
            /**
             * 24 randomly generated bytes by the client
             */
            nonce: string;
        }
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.TokenOperationResult;
            export type $202 = FinAPIComponents.Schemas.OperationBase;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace SendMessage {
        export interface HeaderParameters {
            "Idempotency-Key"?: Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
        }
        export interface RequestBody {
            /**
             * message subject or title
             */
            subject: string;
            /**
             * message body
             */
            body: string;
            correspondent: FinAPIComponents.Schemas.Correspondent;
            /**
             * Collections of owners ids to send the message to
             */
            recipients: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            FinAPIComponents.Schemas.OwnerId /* ^[^:](?:.+):101:(?:.+) */[];
            /**
             * Collection optional attachments
             */
            attachments?: {
                filename?: string /* binary */[];
            };
        }
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.MessageResponse;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace ShareProfile {
        export interface HeaderParameters {
            "Idempotency-Key"?: Parameters.IdempotencyKey;
        }
        namespace Parameters {
            /**
             * example:
             * bank-x:103:ed495b49-2ad8-4e44-a294-405d5e24d181
             */
            export type Id = string; // ^[^:](?:.+):(?:.+):(?:.+)
            export type IdempotencyKey = /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
        }
        export interface PathParameters {
            id: /**
             * example:
             * bank-x:103:ed495b49-2ad8-4e44-a294-405d5e24d181
             */
            Parameters.Id /* ^[^:](?:.+):(?:.+):(?:.+) */;
        }
        export interface RequestBody {
            /**
             * Collections of organizations ids to share the profile with
             */
            organizations: string[];
        }
        namespace Responses {
            export interface $200 {
            }
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace SignatureResult {
        export interface RequestBody {
            /**
             * nonce
             */
            requestId: string;
            assetId?: /**
             * The Asset resource id
             * example:
             * bank-x:102:f461a964-ae08-4e35-b690-24de06d973db
             */
            FinAPIComponents.Schemas.AssetId /* ^[^:](?:.+):102:(?:.+) */;
            intentId: /**
             * The intent resource id
             * example:
             * bank-x:105:9929ccaf-8967-4ba3-9198-a4b8e3128388
             */
            FinAPIComponents.Schemas.IntentId /* ^[^:](?:.+):105:(?:.+) */;
            signature: /**
             *
             * Asset Hash Group (AHG) structure:
             *
             * AHG = hash('SHA3-256', [fields by order]);
             *
             * | order | value | type | comment |
             * |--|--|--|--|
             * | 1 | nonce           | []byte  |  |
             * | 2 | operation       | string  | "transfer" |
             * | 3 | assetType       | string  | "finp2p" |
             * | 4 | assetId         | string  | unique identifier of the asset |
             * | 5 | srcAccountType  | string  | "finId" |
             * | 6 | srcAccount      | string  | source account finId address  |
             * | 7 | dstAccountType  | string  | "finId" |
             * | 8 | dstAccount      | string  | destination account finId address  |
             * | 9 | amount          | string  | string representation of the transfer amount |
             *
             * hashGroups = hash('SHA3-256', [AHG]);
             *
             * Signature = sign(sender private secp256k1 key, hashGroups)
             *
             */
            FinAPIComponents.Schemas.TransferSignature;
        }
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.SignatureResultResponse;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace TransferToken {
        export interface HeaderParameters {
            "Idempotency-Key"?: Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
        }
        export interface RequestBody {
            nonce: /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
            source: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            FinAPIComponents.Schemas.OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            destination: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            FinAPIComponents.Schemas.OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            asset: FinAPIComponents.Schemas.TransferRequestAssetOrder;
        }
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.ExecutionOperationResult;
            export type $202 = FinAPIComponents.Schemas.OperationBase;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace UpdateAssetProfile {
        export interface HeaderParameters {
            "Idempotency-Key"?: Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type Id = /**
             * The Asset resource id
             * example:
             * bank-x:102:f461a964-ae08-4e35-b690-24de06d973db
             */
            FinAPIComponents.Schemas.AssetId /* ^[^:](?:.+):102:(?:.+) */;
            export type IdempotencyKey = /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
        }
        export interface PathParameters {
            id: Parameters.Id;
        }
        export interface RequestBody {
            /**
             * The asset metadata
             */
            metadata?: {
                [name: string]: any;
            };
            /**
             * The asset configuration, in serilized JSON representation (deprecated, use metadata instead)
             */
            config?: string;
            /**
             * A list of regulation verifiers to execute to validate a transaction
             */
            verifiers?: FinAPIComponents.Schemas.AssetVerifier[];
            name: /* The name of the asset */ FinAPIComponents.Schemas.Name /* ^[a-zA-Z0-9\-_. /]*$ */;
            assetPolicies?: FinAPIComponents.Schemas.AssetPolicies;
        }
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.ResourceIdResponse;
            export type $202 = FinAPIComponents.Schemas.OperationBase;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace UpdateAssetProfileIntent {
        export interface HeaderParameters {
            "Idempotency-Key"?: Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type Id = /**
             * The Asset resource id
             * example:
             * bank-x:102:f461a964-ae08-4e35-b690-24de06d973db
             */
            FinAPIComponents.Schemas.AssetId /* ^[^:](?:.+):102:(?:.+) */;
            export type IdempotencyKey = /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
            export type IntentId = /**
             * The intent resource id
             * example:
             * bank-x:105:9929ccaf-8967-4ba3-9198-a4b8e3128388
             */
            FinAPIComponents.Schemas.IntentId /* ^[^:](?:.+):105:(?:.+) */;
        }
        export interface PathParameters {
            id: Parameters.Id;
            intentId: Parameters.IntentId;
        }
        export interface RequestBody {
            /**
             * start time for intent, in epoch (seconds)
             */
            start?: number; // int64
            /**
             * end time for intent, in epoch (seconds)
             */
            end?: number; // int64
            intent?: FinAPIComponents.Schemas.UpdateIntent;
            /**
             * To change the status of the intent
             */
            status?: "Rejected";
        }
        namespace Responses {
            export interface $200 {
            }
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace UpdateCertificate {
        export interface HeaderParameters {
            "Idempotency-Key"?: Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type CertificateId = string;
            export type IdempotencyKey = /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
            export type ProfileId = /**
             * finp2p resource id format
             * example:
             * bank-x:101:9929ccaf-8967-4ba3-9198-a4b8e3128388
             */
            FinAPIComponents.Schemas.ProfileId /* ^[^:](?:.+):(101|102):(?:.+) */;
        }
        export interface PathParameters {
            profileId: Parameters.ProfileId;
            certificateId: Parameters.CertificateId;
        }
        export interface RequestBody {
            /**
             * The issuance date of the Certificate in epoch time seconds
             */
            issuanceDate: number; // int64
            /**
             * The expiration date of the Certificate in epoch time seconds
             */
            expirationDate: number; // int64
            /**
             * Serilized data objects that contain one or more properties that are each related to the subject of the Certificate
             */
            data: string;
        }
        namespace Responses {
            export interface $200 {
            }
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace UpdateCertificateDoc {
        export interface HeaderParameters {
            "Idempotency-Key"?: Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type CertificateId = string;
            export type DocId = string;
            export type IdempotencyKey = /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
            export type ProfileId = string;
        }
        export interface PathParameters {
            docId: Parameters.DocId;
            profileId: Parameters.ProfileId;
            certificateId: Parameters.CertificateId;
        }
        export interface RequestBody {
            /**
             * the document in binary format
             */
            file?: string; // binary
        }
        namespace Responses {
            export interface $200 {
            }
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace UpdateRequestForTransferIntent {
        export interface HeaderParameters {
            "Idempotency-Key"?: Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
            FinAPIComponents.Schemas.Nonce;
            export type IntentId = string; // ^[^:](?:.+):105:(?:.+)
        }
        export interface PathParameters {
            intentId: Parameters.IntentId /* ^[^:](?:.+):105:(?:.+) */;
        }
        export type RequestBody = FinAPIComponents.Schemas.RequestForTransferUpdateIntent;
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.OperationResponse;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $401 = FinAPIComponents.Schemas.ApiAnyError;
            export type $403 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
            export type $502 = FinAPIComponents.Schemas.ApiAnyError;
            export type $503 = FinAPIComponents.Schemas.ApiAnyError;
            export type $504 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
}
