declare namespace Components {
    namespace Schemas {
        export interface APIError {
            /**
             * Error code indicating the specific failure - for more information see [API Errors](./api-error-codes-reference).
             *
             */
            code: number;
            /**
             * A descriptive message providing context about the error.
             */
            message: string;
        }
        export interface APIErrors {
            errors: APIError[];
        }
        export interface AbsolutePollingInterval {
            type: "absolute";
            /**
             * absolute time as epoch time seconds
             */
            time: number;
        }
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
            approval?: PlanApproved | PlanRejected;
        }
        export type Asset = CryptocurrencyAsset | FiatAsset | Finp2pAsset;
        export interface AssetBalance {
            asset: Asset;
            /**
             * The total amount currently in or owed by the account
             */
            current: string; // ^-?\d+(\.\d+)?$
            /**
             * The amount immediately usable from the account
             */
            available: string; // ^-?\d+(\.\d+)?$
            /**
             * The amount pending or on hold within the account
             */
            held: string; // ^-?\d+(\.\d+)?$
            /**
             * list of receipt associated with the balance info
             */
            receipts?: Receipt[];
        }
        export type AssetBalanceAccount = FinIdAccount;
        export interface AssetBalanceInfoRequest {
            account: AssetBalanceAccount;
            asset: Asset;
            marker?: /* marker of balance to denote the balance as of marker */ BalanceMarker;
        }
        export interface AssetBalanceInfoResponse {
            account: AssetBalanceAccount;
            asset: Asset;
            balanceInfo?: AssetBalance;
        }
        export interface AssetCreateResponse {
            ledgerAssetInfo: LedgerAssetInfo;
        }
        export interface AssetDenomination {
            type: /* Indicates how the asset is denominated */ AssetDenominationType;
            /**
             * Unique code identifying the denomination asset type
             */
            code: string; // ^[a-zA-Z0-9]*$
        }
        /**
         * Indicates how the asset is denominated
         */
        export type AssetDenominationType = "fiat" | "cryptocurrency";
        export interface AssetIdentifier {
            assetIdentifierType: /* Classification type standards */ AssetIdentifierType;
            /**
             * The classification standard used to identify the asset
             */
            assetIdentifierValue: string;
        }
        /**
         * Classification type standards
         */
        export type AssetIdentifierType = "ISIN" | "CUSIP" | "SEDOL" | "DTI" | "CMU" | "FIGI" | "CUSTOM";
        export interface AssetMetadataAndConfigError {
            code: 4108;
            message: "Asset metadata and config cannot be provided at the same time";
        }
        /**
         * The name of the asset
         */
        export type AssetName = string; // ^[a-zA-Z0-9\-_. /]*$
        export interface Balance {
            asset: Asset;
            /**
             * the number of asset tokens
             */
            balance: string;
        }
        /**
         * marker of balance to denote the balance as of marker
         */
        export type BalanceMarker = /* marker of balance to denote the balance as of marker */ BalanceMarkerTimestamp | BalanceMarkerTransactionBlock;
        export interface BalanceMarkerTimestamp {
            type: "timestamp";
            /**
             * epoch timestamp in seconds
             */
            timestamp: number; // int64
        }
        export interface BalanceMarkerTransactionBlock {
            type: "transactionBlock";
            blockNumber: number; // int64
            transaction: string;
        }
        export interface CallbackEndpoint {
            type: "endpoint";
        }
        export interface CallbackResultsStrategy {
            type: "callback";
            callback: CallbackEndpoint;
        }
        export interface ContractDetails {
            /**
             * the type of the identifier
             */
            type: "contractDetails";
            /**
             * the network
             */
            network: string;
            /**
             * the address
             */
            address: string;
            /**
             * The standard of the token (e.g., ERC20, ERC721)
             */
            TokenStandard?: string;
            additionalContractDetails?: FinP2PEVMOperatorDetails;
        }
        export interface CreateAssetOperation {
            /**
             * unique correlation id which identify the operation
             */
            cid: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            operationMetadata?: /* additional metadata regarding the operation */ OperationMetadata;
            error?: CreateAssetOperationErrorInformation;
            response?: AssetCreateResponse;
        }
        export interface CreateAssetOperationErrorInformation {
            code?: number; // uint32
            message?: string;
        }
        export interface CreateAssetRequest {
            /**
             * The asset metadata
             */
            metadata?: {
                [name: string]: any;
            };
            asset: Asset;
            ledgerAssetBinding?: LedgerAssetBinding;
            name?: /* The name of the asset */ AssetName /* ^[a-zA-Z0-9\-_. /]*$ */;
            issuerId?: /**
             * Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerResourceId /* ^[^:](?:.+):101:(?:.+) */;
            denomination?: AssetDenomination;
            assetIdentifier?: AssetIdentifier;
        }
        export interface CreateAssetResponse {
            /**
             * unique correlation id which identify the operation
             */
            cid: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            operationMetadata?: /* additional metadata regarding the operation */ OperationMetadata;
            error?: CreateAssetOperationErrorInformation;
            response?: AssetCreateResponse;
        }
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
            address: string;
        }
        export interface CryptocurrencyAsset {
            type: "cryptocurrency";
            /**
             * unique identifier symbol of the cryptocurrency
             */
            code: string;
        }
        export interface CustomAsset {
            type: "custom";
        }
        export interface CustomError {
            code: number;
            message: string;
        }
        export type DepositAsset = CryptocurrencyAsset | FiatAsset | Finp2pAsset | CustomAsset;
        export interface DepositInstruction {
            account: /* describes destination for remote operations operations */ Destination;
            /**
             * Instructions for the deposit operation
             */
            description?: string;
            paymentOptions?: PaymentMethods;
            /**
             * Any addition deposit specific information, deprecated use "payment method options" instead fields
             */
            details?: {
                [key: string]: any;
            };
            /**
             * operation id reference while will correlate with any receipt associated with the deposit operation
             */
            operationId?: string;
        }
        export interface DepositInstructionRequest {
            destination: /* describes destination for remote operations operations */ Destination;
            owner: Source;
            asset: DepositAsset;
            /**
             * Amount to deposit
             */
            amount?: string;
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
            Nonce;
            signature?: /* represent a signature template information */ Signature;
        }
        export interface DepositInstructionResponse {
            /**
             * unique correlation id which identify the operation
             */
            cid: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            operationMetadata?: /* additional metadata regarding the operation */ OperationMetadata;
            error?: DepositOperationErrorInformation;
            response?: DepositInstruction;
        }
        export interface DepositOperation {
            /**
             * unique correlation id which identify the operation
             */
            cid: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            operationMetadata?: /* additional metadata regarding the operation */ OperationMetadata;
            error?: DepositOperationErrorInformation;
            response?: DepositInstruction;
        }
        export interface DepositOperationErrorInformation {
        }
        /**
         * describes destination for remote operations operations
         */
        export interface Destination {
            /**
             * FinID, public key of the user
             */
            finId: string;
            account: FinIdAccount | CryptoWalletAccount | FiatAccount;
        }
        export interface EIP712Domain {
            name?: string;
            version?: string;
            chainId?: number; // uint64
            verifyingContract?: string; // address
        }
        export interface EIP712FieldDefinition {
            name?: string;
            type?: string;
        }
        export interface EIP712Template {
            type: "EIP712";
            domain: EIP712Domain;
            message: {
                [name: string]: EIP712TypedValue;
            };
            types: EIP712Types;
            primaryType: string;
            /**
             * hex representation of template hash
             */
            hash: string;
        }
        export type EIP712TypeArray = EIP712TypedValue[];
        export type EIP712TypeBool = boolean;
        export type EIP712TypeByte = string; // ^0x[0-9a-fA-F]+$
        export interface EIP712TypeDefinition {
            name?: string;
            fields?: EIP712FieldDefinition[];
        }
        export type EIP712TypeInteger = number;
        export interface EIP712TypeObject {
            [name: string]: EIP712TypedValue;
        }
        export type EIP712TypeString = string; // ^(?:$|0([^x].*)?|[^0].*)$
        export type EIP712TypedValue = EIP712TypeString /* ^(?:$|0([^x].*)?|[^0].*)$ */ | EIP712TypeInteger | EIP712TypeBool | EIP712TypeByte /* ^0x[0-9a-fA-F]+$ */ | EIP712TypeObject | EIP712TypeArray;
        export interface EIP712Types {
            definitions?: EIP712TypeDefinition[];
        }
        export interface ExecutionContext {
            /**
             * execution plan id
             */
            executionPlanId: string;
            /**
             * execution instruction sequence number
             */
            instructionSequenceNumber: number; // uint32
        }
        export interface ExecutionOperationErrorInformation {
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
            approval?: PlanApproved | PlanRejected;
        }
        export interface ExecutionPlanCancellationProposal {
            proposalType: "cancel";
        }
        export interface ExecutionPlanProposal {
            proposalType: "plan";
        }
        export interface ExecutionPlanProposalRequest {
            /**
             * execution plan information
             */
            executionPlan: {
                /**
                 * execution plan id
                 */
                id: string;
                /**
                 * type of proposal payload
                 */
                proposal: /* type of proposal payload */ ExecutionPlanCancellationProposal;
            };
        }
        /**
         * provides status update on the agreement reached for a specific proposal
         */
        export interface ExecutionPlanProposalStatusRequest {
            status: "approved" | "rejected";
            request: {
                /**
                 * execution plan information
                 */
                executionPlan: {
                    /**
                     * execution plan id
                     */
                    id: string;
                    /**
                     * type of proposal payload
                     */
                    proposal: /* type of proposal payload */ ExecutionPlanCancellationProposal;
                };
            };
        }
        export interface FiatAccount {
            type: "fiatAccount";
            /**
             * IBAN or other code to represent a fiat account
             */
            code: string;
        }
        export interface FiatAsset {
            type: "fiat";
            /**
             * unique identifier code of the fiat currency - based on ISO-4217
             */
            code: string;
        }
        /**
         * describing a field in the hash group
         */
        export interface Field {
            /**
             * name of field
             */
            name: string;
            /**
             * type of field
             */
            type: "string" | "int" | "bytes";
            /**
             * hex representation of the field value
             */
            value: string;
        }
        export interface FinIdAccount {
            type: "finId";
            /**
             * FinID, public key of the user
             */
            finId: string;
        }
        export interface FinP2PEVMOperatorDetails {
            /**
             * The FinP2P Operator Contract Address
             */
            FinP2POperatorContractAddress?: string;
            /**
             * Indicates if allowance is required
             */
            allowanceRequired?: boolean;
        }
        export interface Finp2pAsset {
            type: "finp2p";
            /**
             * Unique resource ID of the FinP2P asset [format]('https://finp2p.atlassian.net/wiki/spaces/FINP2P/pages/67764240/FinP2P+Network+Interface+Specification#ResourceID-format')
             *
             */
            resourceId: string;
        }
        export interface GeneralClientError {
            code: 1000;
            message: "General client error";
        }
        export interface GeneralServerError {
            code: 2000;
            message: "General server error";
        }
        export interface GetAssetBalanceRequest {
            owner: Source;
            asset: Asset;
        }
        export interface GetAssetBalanceResponse {
            asset: Asset;
            /**
             * the number of asset tokens
             */
            balance: string;
        }
        export interface GetOperationStatusRequest {
            /**
             * correlation id of an operation
             */
            cid?: string;
        }
        export type GetOperationStatusResponse = OperationStatus;
        export interface GetReceiptResponse {
            /**
             * unique correlation id which identify the operation
             */
            cid: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            operationMetadata?: /* additional metadata regarding the operation */ OperationMetadata;
            error?: ReceiptOperationErrorInformation;
            response?: Receipt;
        }
        /**
         * hash function types
         */
        export type HashFunction = "unspecified" | "sha3_256" | "sha3-256" | "blake2b" | "keccak_256" | "keccak-256";
        export interface HashGroup {
            /**
             * hex representation of the hash group hash value
             */
            hash: string;
            /**
             * list of fields by order they appear in the hash group
             */
            fields: /* describing a field in the hash group */ Field[];
        }
        /**
         * ordered list of hash groups
         */
        export interface HashListTemplate {
            type: "hashList";
            hashGroups: HashGroup[];
            /**
             * hex representation of the combined hash groups hash value
             */
            hash: string;
        }
        export interface HoldOperationRequest {
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
            /**
             * Escrow operation id
             */
            operationId: string;
            source: Source;
            destination?: /* describes destination for remote operations operations */ Destination;
            /**
             * How many units of the asset tokens
             */
            quantity: string;
            asset: Asset;
            /**
             * ttl expiry value indicating the escrow hold time limitation
             */
            expiry: number; // uint64
            signature: /* represent a signature template information */ Signature;
            executionContext?: ExecutionContext;
        }
        export interface HoldOperationResponse {
            /**
             * unique correlation id which identify the operation
             */
            cid: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            operationMetadata?: /* additional metadata regarding the operation */ OperationMetadata;
            error?: ReceiptOperationErrorInformation;
            response?: Receipt;
        }
        export interface IbanAccountDetails {
            type: "iban";
            iban: string;
        }
        export interface IssueAssetsRequest {
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
            destination: FinIdAccount;
            /**
             * How many units of the asset tokens
             */
            quantity: string;
            asset: Finp2pAsset;
            /**
             * Reference to the corresponding settlement operation
             */
            settlementRef: string;
            signature: /* represent a signature template information */ Signature;
            executionContext?: ExecutionContext;
        }
        export interface IssueAssetsResponse {
            /**
             * unique correlation id which identify the operation
             */
            cid: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            operationMetadata?: /* additional metadata regarding the operation */ OperationMetadata;
            error?: ReceiptOperationErrorInformation;
            response?: Receipt;
        }
        export type LedgerAssetBinding = LedgerTokenId;
        export interface LedgerAssetInfo {
            ledgerTokenId: LedgerTokenId;
            ledgerReference?: ContractDetails;
        }
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
        export type OperationStatus = OperationStatusCreateAsset | OperationStatusDeposit | OperationStatusReceipt | OperationStatusApproval;
        export interface OperationStatusApproval {
            type: "approval";
            operation: ExecutionPlanApprovalOperation;
        }
        export interface OperationStatusCreateAsset {
            type: "createAsset";
            operation: CreateAssetOperation;
        }
        export interface OperationStatusDeposit {
            type: "deposit";
            operation: DepositOperation;
        }
        export interface OperationStatusReceipt {
            type: "receipt";
            operation: ReceiptOperation;
        }
        export type OperationType = "issue" | "transfer" | "hold" | "release" | "redeem";
        /**
         * Owner resource id
         * example:
         * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
         */
        export type OwnerResourceId = string; // ^[^:](?:.+):101:(?:.+)
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
        export type PayoutAsset = CryptocurrencyAsset | FiatAsset | Finp2pAsset;
        export interface PayoutInstruction {
            /**
             * withdrawal description
             */
            description: string;
        }
        export interface PayoutRequest {
            source: Source;
            destination?: /* describes destination for remote operations operations */ Destination;
            /**
             * How many units of the asset
             */
            quantity: string;
            payoutInstruction?: PayoutInstruction;
            asset: PayoutAsset;
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
            signature?: /* represent a signature template information */ Signature;
        }
        export interface PayoutResponse {
            /**
             * unique correlation id which identify the operation
             */
            cid: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            operationMetadata?: /* additional metadata regarding the operation */ OperationMetadata;
            error?: ReceiptOperationErrorInformation;
            response?: Receipt;
        }
        export interface PlanApprovalResponse {
            approval?: PlanApproved | PlanRejected;
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
        /**
         * additional proof information attached to a receipt
         */
        export type ProofPolicy = /* additional proof information attached to a receipt */ SignatureProofPolicy | /* no proof validation required for this policy */ NoProofPolicy;
        export interface RandomPollingInterval {
            type: "random";
        }
        export interface Receipt {
            /**
             * the receipt id
             */
            id: string;
            asset: Asset;
            /**
             * How many units of the asset tokens
             */
            quantity: string;
            /**
             * transaction timestamp
             */
            timestamp: number; // int64
            source?: Source;
            destination?: /* describes destination for remote operations operations */ Destination;
            transactionDetails?: /* additional ledger specific */ TransactionDetails;
            operationType?: OperationType;
            tradeDetails: ReceiptTradeDetails;
            proof?: /* additional proof information attached to a receipt */ ProofPolicy;
        }
        export interface ReceiptExecutionContext {
            executionPlanId: string;
            instructionSequenceNumber: number;
        }
        export interface ReceiptOperation {
            /**
             * unique correlation id which identify the operation
             */
            cid: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            operationMetadata?: /* additional metadata regarding the operation */ OperationMetadata;
            error?: ReceiptOperationErrorInformation;
            response?: Receipt;
        }
        export interface ReceiptOperationErrorInformation {
            /**
             * 1 for failure in regApps validation, 4 failure in signature verification
             */
            code: number; // uint32
            message: string;
            regulationErrorDetails?: RegulationError[];
        }
        export interface ReceiptTradeDetails {
            intentId?: string;
            intentVersion?: string;
            executionContext?: ReceiptExecutionContext;
        }
        export interface RedeemAssetsRequest {
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
            operationId?: string;
            source: FinIdAccount;
            /**
             * How many units of the asset tokens
             */
            quantity: string;
            asset: Finp2pAsset;
            /**
             * Reference to the corresponding payment operation
             */
            settlementRef: string;
            signature: /* represent a signature template information */ Signature;
            executionContext?: ExecutionContext;
        }
        export interface RedeemAssetsResponse {
            /**
             * unique correlation id which identify the operation
             */
            cid: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            operationMetadata?: /* additional metadata regarding the operation */ OperationMetadata;
            error?: ReceiptOperationErrorInformation;
            response?: Receipt;
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
            failureType: "regulationFailure";
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
        export interface ReleaseOperationRequest {
            /**
             * Hold operation id
             */
            operationId: string;
            source: Source;
            destination: /* describes destination for remote operations operations */ Destination;
            /**
             * How many units of the asset tokens
             */
            quantity: string;
            asset: Asset;
            executionContext?: ExecutionContext;
        }
        export interface ReleaseOperationResponse {
            /**
             * unique correlation id which identify the operation
             */
            cid: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            operationMetadata?: /* additional metadata regarding the operation */ OperationMetadata;
            error?: ReceiptOperationErrorInformation;
            response?: Receipt;
        }
        export interface RollbackOperationRequest {
            /**
             * Hold operation id
             */
            operationId: string;
            source: Source;
            /**
             * How many units of the asset tokens
             */
            quantity: string;
            asset: Asset;
            executionContext?: ExecutionContext;
        }
        export interface RollbackOperationResponse {
            /**
             * unique correlation id which identify the operation
             */
            cid: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            operationMetadata?: /* additional metadata regarding the operation */ OperationMetadata;
            error?: ReceiptOperationErrorInformation;
            response?: Receipt;
        }
        /**
         * represent a signature template information
         */
        export interface Signature {
            /**
             * hex representation of the signature
             */
            signature: string;
            template: SignatureTemplate;
            hashFunc: /* hash function types */ HashFunction;
        }
        export interface SignatureProofPolicy {
            type: "signatureProofPolicy";
            signature?: /* represent a signature template information */ Signature;
        }
        export type SignatureTemplate = /* ordered list of hash groups */ HashListTemplate | EIP712Template;
        export interface SortCodeDetails {
            type: "sortCode";
            /**
             * sort code has XX-XX-XX format
             */
            code: string; // ^\d{2}-\d{2}-\d{2}$
            accountNumber: string;
        }
        export interface Source {
            /**
             * FinID, public key of the user
             */
            finId: string;
            account: FinIdAccount;
        }
        export interface SwiftAccountDetails {
            type: "bic";
            swiftCode: string;
            accountNumber: string;
        }
        /**
         * additional ledger specific
         */
        export interface TransactionDetails {
            /**
             * The Transaction id on the underlying ledger
             */
            transactionId: string;
            /**
             * The Operation id
             */
            operationId?: string;
        }
        export interface TransferAssetRequest {
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
            source: Source;
            destination: /* describes destination for remote operations operations */ Destination;
            /**
             * How many units of the asset tokens
             */
            quantity: string;
            asset: Asset;
            /**
             * Reference to the corresponding payment operation
             */
            settlementRef: string;
            signature: /* represent a signature template information */ Signature;
            executionContext?: ExecutionContext;
        }
        export interface TransferAssetResponse {
            /**
             * unique correlation id which identify the operation
             */
            cid: string;
            /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
            isCompleted: boolean;
            operationMetadata?: /* additional metadata regarding the operation */ OperationMetadata;
            error?: ReceiptOperationErrorInformation;
            response?: Receipt;
        }
        export interface ValidationFailure {
            failureType: "validationFailure";
            /**
             * ledger error code for validation
             */
            code: number; // uint32
            message: string;
        }
        export type WireDetails = IbanAccountDetails | SwiftAccountDetails | SortCodeDetails;
        export interface WireTransfer {
            type: "wireTransfer";
            accountHolderName: string;
            bankName: string;
            wireDetails: WireDetails;
            line1?: string;
            city?: string;
            postalCode?: string;
            country?: string;
        }
        export interface WireTransferUSA {
            type: "wireTransferUSA";
            accountNumber: string;
            routingNumber: string;
            line1?: string;
            city?: string;
            postalCode?: string;
            country?: string;
            state?: string;
        }
    }
}
declare namespace Paths {
    namespace ApproveExecutionPlan {
        export type RequestBody = Components.Schemas.ApproveExecutionPlanRequest;
        namespace Responses {
            export type $200 = Components.Schemas.ApproveExecutionPlanResponse;
        }
    }
    namespace CreateAsset {
        export interface HeaderParameters {
            "Idempotency-Key": Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = string;
        }
        export type RequestBody = Components.Schemas.CreateAssetRequest;
        namespace Responses {
            export type $200 = Components.Schemas.CreateAssetResponse;
        }
    }
    namespace DepositInstruction {
        export interface HeaderParameters {
            "Idempotency-Key": Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = string;
        }
        export type RequestBody = Components.Schemas.DepositInstructionRequest;
        namespace Responses {
            export type $200 = Components.Schemas.DepositInstructionResponse;
        }
    }
    namespace ExecutionPlanProposal {
        export type RequestBody = Components.Schemas.ExecutionPlanProposalRequest;
        namespace Responses {
            export type $200 = Components.Schemas.ApproveExecutionPlanResponse;
        }
    }
    namespace ExecutionPlanProposalStatus {
        export type RequestBody = /* provides status update on the agreement reached for a specific proposal */ Components.Schemas.ExecutionPlanProposalStatusRequest;
    }
    namespace GetAssetBalance {
        export type RequestBody = Components.Schemas.GetAssetBalanceRequest;
        namespace Responses {
            export type $200 = Components.Schemas.GetAssetBalanceResponse;
        }
    }
    namespace GetAssetBalanceInfo {
        export type RequestBody = Components.Schemas.AssetBalanceInfoRequest;
        namespace Responses {
            export type $200 = Components.Schemas.AssetBalanceInfoResponse;
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
            export type $200 = Components.Schemas.GetOperationStatusResponse;
        }
    }
    namespace GetReceipt {
        namespace Parameters {
            export type TransactionId = string;
        }
        export interface PathParameters {
            transactionId: Parameters.TransactionId;
        }
        namespace Responses {
            export type $200 = Components.Schemas.GetReceiptResponse;
        }
    }
    namespace HoldOperation {
        export interface HeaderParameters {
            "Idempotency-Key": Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = string;
        }
        export type RequestBody = Components.Schemas.HoldOperationRequest;
        namespace Responses {
            export type $200 = Components.Schemas.HoldOperationResponse;
        }
    }
    namespace IssueAssets {
        export interface HeaderParameters {
            "Idempotency-Key": Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = string;
        }
        export type RequestBody = Components.Schemas.IssueAssetsRequest;
        namespace Responses {
            export type $200 = Components.Schemas.IssueAssetsResponse;
        }
    }
    namespace Payout {
        export interface HeaderParameters {
            "Idempotency-Key": Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = string;
        }
        export type RequestBody = Components.Schemas.PayoutRequest;
        namespace Responses {
            export type $200 = Components.Schemas.PayoutResponse;
        }
    }
    namespace RedeemAssets {
        export interface HeaderParameters {
            "Idempotency-Key": Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = string;
        }
        export type RequestBody = Components.Schemas.RedeemAssetsRequest;
        namespace Responses {
            export type $200 = Components.Schemas.RedeemAssetsResponse;
        }
    }
    namespace ReleaseOperation {
        export interface HeaderParameters {
            "Idempotency-Key": Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = string;
        }
        export type RequestBody = Components.Schemas.ReleaseOperationRequest;
        namespace Responses {
            export type $200 = Components.Schemas.ReleaseOperationResponse;
        }
    }
    namespace RollbackOperation {
        export interface HeaderParameters {
            "Idempotency-Key": Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = string;
        }
        export type RequestBody = Components.Schemas.RollbackOperationRequest;
        namespace Responses {
            export type $200 = Components.Schemas.RollbackOperationResponse;
        }
    }
    namespace TransferAsset {
        export interface HeaderParameters {
            "Idempotency-Key": Parameters.IdempotencyKey;
        }
        namespace Parameters {
            export type IdempotencyKey = string;
        }
        export type RequestBody = Components.Schemas.TransferAssetRequest;
        namespace Responses {
            export type $200 = Components.Schemas.TransferAssetResponse;
        }
    }
}
