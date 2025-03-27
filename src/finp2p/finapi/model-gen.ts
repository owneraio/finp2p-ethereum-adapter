declare namespace FinAPIComponents {
    namespace Schemas {
        /**
         * describes account information
         */
        export interface Account {
            account: FinIdAccount | CryptoWalletAccount | FiatAccount;
            asset: Asset;
        }
        /**
         * describes destination for remote operations
         */
        export interface AccountInformation {
            /**
             * FinID, public key of the user
             */
            finId: string;
            account: FinIdAccount | CryptoWalletAccount | FiatAccount;
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
        export type Asset = CryptocurrencyAsset | FiatAsset | Finp2pAsset;
        /**
         * The Asset resource id
         * example:
         * bank-x:102:f461a964-ae08-4e35-b690-24de06d973db
         */
        export type AssetId = string; // ^[^:](?:.+):102:(?:.+)
        export interface AssetInstruction {
            account: AssetInstructionAccount;
            asset: Asset;
        }
        export type AssetInstructionAccount = FinIdAccount;
        export interface AssetIntent {
            /**
             * start time for intent, in epoch (seconds)
             */
            start: number; // int64
            /**
             * end time for intent, in epoch (seconds)
             */
            end: number; // int64
            intent: Intent;
        }
        export type AssetMatchingCriteria = {
            assetTypes: ("finp2p" | "fiat" | "cryptocurrency" | "custom")[];
            assetNameRegexp?: string | null;
            assetCodes?: string[];
        } | null;
        export interface AssetMetadataAndConfigError {
            code: 4108;
            message: "Asset metadata and config cannot be provided at the same time";
        }
        export interface AssetTerm {
            asset: Asset;
            /**
             * the total number of units
             */
            amount: string;
        }
        export interface AwaitInstruction {
            type: "await";
            waitUntil: number; // uint64
        }
        export type AwaitOperationDetails = {
            type: "await";
            awaitTarget?: "close" | "open";
        } | null;
        export interface BuyingIntent {
            type: "buyingIntent";
            /**
             * resource id of the buyer
             */
            buyer: string;
            assetTerm: Finp2pAssetTerm;
            assetInstruction: IntentAssetInstruction;
            settlementTerm: SettlementTerm;
            settlementInstruction?: BuyingIntentSettlementInstruction;
            signaturePolicy?: PresignedBuyIntentSignaturePolicy | ManualSignaturePolicy;
        }
        export interface BuyingIntentSettlementInstruction {
            sourceAccount: /* describes account information */ Account;
        }
        export interface CloseAmountTerm {
            type: "closeAmountTerm";
            /**
             * amount of funds payable at maturity
             */
            closeAmount: string;
        }
        export type Constraints = {
            allowedCounterOrganizations?: string[];
            allowedCounterAssetTypes?: string[];
        } | null;
        export interface CreatePolicyRequest {
            /**
             * unique policy id
             */
            policyId: string;
            /**
             * priority of the policy
             */
            priority: number; // uint32
            intent: IntentType;
            /**
             * description of the policy
             */
            description: string;
            /**
             * whether policy should be applied to all assets
             */
            isDefault?: boolean;
            instructions: Instruction[];
            assetMatchingCriteria?: AssetMatchingCriteria;
            constraints?: Constraints;
        }
        export interface CreatePolicyResponse {
            /**
             * unique policy id
             */
            policyId: string;
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
        export interface EscrowSettlement {
            type: "escrow";
            sourceAccount: /* describes account information */ Account;
            destinationAccount: /* describes account information */ Account;
        }
        export interface Execution {
            plan: ExecutionPlan;
            /**
             * Approvals/signatures of participants
             */
            approvals: ExecutionPlanApproval[];
            /**
             * creation time in seconds since unix epoch
             */
            creationTimestamp: number; // int64
            /**
             * Represents a set of completed execution instructions
             */
            instructionsCompletionEvents: InstructionCompletionEvent[];
            /**
             * Sequence number of the current instruction
             */
            currentInstructionSequence: number; // uint32
            /**
             * Current status of the execution plan
             */
            executionPlanStatus: "proposed" | "approved" | "rejected" | "failed" | "completed";
        }
        export interface ExecutionInstruction {
            sequence: number; // uint32
            organizations: string[];
            executionPlanOperation: ExecutionPlanOperation;
            timeout?: number; // int32
        }
        export interface ExecutionParticipant {
            organizationId: string;
            roles: ("contributor" | "observer")[];
        }
        export interface ExecutionPlan {
            id: /**
             * The execution plan  resource id
             * example:
             * bank-x:106:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            ExecutionPlanId /* ^[^:](?:.+):106:(?:.+) */;
            intent: AssetIntent;
            instructions: ExecutionInstruction[];
            participants: ExecutionParticipant[];
        }
        export interface ExecutionPlanApproval {
            /**
             * An Id of the organisation approved a plan
             */
            organizationId: string;
        }
        /**
         * The execution plan  resource id
         * example:
         * bank-x:106:511c1d7f-4ed8-410d-887c-a10e3e499a01
         */
        export type ExecutionPlanId = string; // ^[^:](?:.+):106:(?:.+)
        export type ExecutionPlanOperation = HoldInstruction | ReleaseInstruction | IssueInstruction | TransferInstruction | AwaitInstruction | RevertHoldInstruction | RedemptionInstruction;
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
            finId: string;
            orgId?: string;
        }
        export interface Finp2pAsset {
            type: "finp2p";
            resourceId: /**
             * The Asset resource id
             * example:
             * bank-x:102:f461a964-ae08-4e35-b690-24de06d973db
             */
            AssetId /* ^[^:](?:.+):102:(?:.+) */;
        }
        export interface Finp2pAssetTerm {
            asset: Finp2pAsset;
            /**
             * the total number of units
             */
            amount: string;
        }
        export interface GeneralClientError {
            code: 1000;
            message: "General client error";
        }
        export interface GeneralServerError {
            code: 2000;
            message: "General server error";
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
        export interface HoldInstruction {
            type: "hold";
            source: /* describes destination for remote operations */ AccountInformation;
            destination: /* describes destination for remote operations */ AccountInformation;
            asset: Asset;
            amount: string;
            signature: /* represent a signature template information */ Signature;
        }
        export type HoldOperationDetails = {
            type: "hold";
            accountRole: string;
        } | null;
        export interface Instruction {
            instruction: "Hold" | "Transfer" | "Release" | "Await" | "Issue" | "RevertHold" | "Redeem";
            sequence: number; // uint32
            executors: ("self" | "counterparty")[];
            timeout?: Tolerance;
            onFailure?: Transition;
            onSuccess: Transition;
            onTimeout?: Transition;
            details?: HoldOperationDetails | TransferOperationDetails | IssueOperationDetails | ReleaseOperationDetails | AwaitOperationDetails | RevertHoldOperationDetails;
        }
        export interface InstructionCompletionError {
            type: "error";
            /**
             * 1 for failure in regApps validation, 2 for failure in intent validation, 3 failure in settlement, 4 failure in signature verification
             */
            code: number;
            message: string;
        }
        export interface InstructionCompletionEvent {
            /**
             * Sequence number of the instruction involved
             */
            instructionSequenceNumber: number; // uint32
            output?: ReceiptOutput | InstructionCompletionError;
        }
        export type InstructionTransition = {
            type: "instruction";
            sequence: number; // uint32
        } | null;
        export type Intent = PrimarySale | BuyingIntent | SellingIntent | LoanIntent | RedemptionIntent | PrivateOfferIntent | RequestForTransferIntent;
        export interface IntentAssetInstruction {
            account: AssetInstruction;
        }
        /**
         * The intent resource id
         * example:
         * bank-x:105:f461a964-ae08-4e35-b690-24de06d973db
         */
        export type IntentId = string; // ^[^:](?:.+):105:(?:.+)
        export type IntentType = "primarySale" | "buyingIntent" | "sellingIntent" | "loanIntent" | "redemptionIntent" | "privateOfferIntent";
        export interface InterestRateTerm {
            type: "interestRateTerm";
            /**
             * indicative annual interest rate of the operation
             */
            interestRate: string;
        }
        export interface IssueInstruction {
            type: "issue";
            asset: Asset;
            destination: /* describes destination for remote operations */ AccountInformation;
            amount: string;
            signature: /* represent a signature template information */ Signature;
        }
        export type IssueOperationDetails = {
            type: "issue";
            accountRole?: string;
        } | null;
        export type LoanConditions = RepaymentTerm | InterestRateTerm | CloseAmountTerm;
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
            assetTerm: Finp2pAssetTerm;
            assetInstruction: LoanIntentAssetInstruction;
            settlementTerm: SettlementTerm;
            settlementInstruction?: LoanIntentSettlementInstruction;
            loanInstruction?: LoanInstruction;
            signaturePolicy?: PresignedLoanIntentSignaturePolicy;
        }
        export interface LoanIntentAssetInstruction {
            borrowerAccount: AssetInstruction;
            lenderAccount: AssetInstruction;
        }
        export interface LoanIntentSettlementInstruction {
            borrowerAccount: /* describes account information */ Account;
            lenderAccount: /* describes account information */ Account;
        }
        export interface ManualSignaturePolicy {
            type: "manualPolicy";
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
        /**
         * The Owner resource id
         * example:
         * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
         */
        export type OwnerId = string; // ^[^:](?:.+):101:(?:.+)
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
            assetInstruction: IntentAssetInstruction;
            settlementTerm: SettlementTerm;
            signaturePolicy?: PresignedPrivateOfferIntentSignaturePolicy | ManualSignaturePolicy;
            settlementInstruction?: SellingIntentSettlementInstruction;
        }
        export type ProofPolicy = SignatureProofPolicy | /* no proof validation required for this policy */ NoProofPolicy;
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
        export interface ReceiptOutput {
            type: "receipt";
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
            operationType?: "hold" | "issue" | "redeem" | "release" | "transfer" | "unknown";
            operationRef?: string;
            timestamp: number;
            proof?: ProofPolicy;
        }
        export interface ReceiptPaymentDetails {
            type: "payment";
            source?: /* describes account information */ Account;
            destination?: /* describes account information */ Account;
            transactionDetails: /* Additional input and output details for UTXO supporting DLTs */ ReceiptTransactionDetails;
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
        export interface RedemptionInstruction {
            type: "redemption";
            asset: Asset;
            source: /* describes destination for remote operations */ AccountInformation;
            destination: /* describes destination for remote operations */ AccountInformation;
            amount: string;
            signature: /* represent a signature template information */ Signature;
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
            assetInstruction: IntentAssetInstruction;
            settlementTerm: SettlementTerm;
            settlementInstruction: RedemptionIntentSettlementInstruction;
            conditions?: RedemptionIntentConditions;
        }
        export interface RedemptionIntentConditions {
            /**
             * date and time until transfer has to take place, in epoch (seconds)
             */
            transferDue?: number; // int64
        }
        export interface RedemptionIntentSettlementInstruction {
            sourceAccounts: /* describes account information */ Account[];
        }
        export interface ReleaseInstruction {
            type: "release";
            asset: Asset;
            source: /* describes destination for remote operations */ AccountInformation;
            destination: /* describes destination for remote operations */ AccountInformation;
            amount: string;
        }
        export type ReleaseOperationDetails = {
            type: "release";
            holdInstructionSequence?: number; // uin32
            accountRole?: string;
        } | null;
        export interface RepaymentTerm {
            type: "repaymentTerm";
            /**
             * amount of funds payable at maturity
             */
            closeAmount: string;
            /**
             * indicative annual interest rate of the operation
             */
            interestRate?: string;
        }
        export interface RequestForTransferIntent {
            type: "requestForTransferIntent";
            creditor: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            debitor: /**
             * The Owner resource id
             * example:
             * bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            OwnerId /* ^[^:](?:.+):101:(?:.+) */;
            assetTerm: Finp2pAssetTerm;
            assetInstruction: IntentAssetInstruction;
            signaturePolicy?: ManualSignaturePolicy;
        }
        export interface RevertHoldInstruction {
            type: "revert-hold";
            asset: Asset;
            source?: /* describes destination for remote operations */ AccountInformation;
            destination: /* describes destination for remote operations */ AccountInformation;
        }
        export type RevertHoldOperationDetails = {
            type: "revertHold";
            holdInstructionSequence?: number; // uin32
        } | null;
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
        export interface SellingIntentSettlementInstruction {
            destinationAccounts: /* describes account information */ Account[];
        }
        export interface SettlementTerm {
            asset: Asset;
            /**
             * A unit value represented as a string, the value is a decimal number
             */
            unitValue: string;
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
            signature: /* represent a signature template information */ Signature;
        }
        export type SignatureTemplate = /* ordered list of hash groups */ HashListTemplate | EIP712Template;
        export type StatusTransition = {
            type: "status";
            status: "proposed" | "approved" | "rejected" | "completed" | "failed" | "halted";
        } | null;
        export type Tolerance = {
            value: number; // uint32
            options?: ToleranceOptions;
        } | null;
        export type ToleranceOptions = {
            allowedValues?: number /* uint32 */[];
            percentageDeviation?: number; // uint32
            absoluteDeviation: number; // uint32
        } | {
            allowedValues?: number /* uint32 */[];
            percentageDeviation: number; // uint32
            absoluteDeviation?: number; // uint32
        };
        export interface Trade {
            executionPlanId: /**
             * The execution plan  resource id
             * example:
             * bank-x:106:511c1d7f-4ed8-410d-887c-a10e3e499a01
             */
            ExecutionPlanId /* ^[^:](?:.+):106:(?:.+) */;
            /**
             * Sequence number of the current instruction
             */
            sequence?: number; // uint32
        }
        export interface TradingPolicy {
            /**
             * unique policy id
             */
            policyId: string;
            /**
             * priority of the policy
             */
            priority: number; // uint32
            intent: IntentType;
            /**
             * description of the policy
             */
            description: string;
            /**
             * whether policy should be applied to all assets
             */
            isDefault: boolean;
            /**
             * version of the trading policy
             */
            version?: number; // uint32
            instructions: Instruction[];
            assetMatchingCriteria?: AssetMatchingCriteria;
            constraints?: Constraints;
        }
        export interface Transaction {
            /**
             * the receipt id
             */
            id: string;
            asset: Asset;
            /**
             * quantity of the assets
             */
            quantity: string;
            /**
             * transaction timestamp
             */
            timestamp: number; // int64
            source?: /* describes destination for remote operations */ AccountInformation;
            destination?: /* describes destination for remote operations */ AccountInformation;
            transactionDetails: /* Additional input and output details for UTXO supporting DLTs */ TransactionDetails;
            operationType?: "issue" | "transfer" | "hold" | "release" | "redeem";
            proof?: ProofPolicy;
        }
        /**
         * Additional input and output details for UTXO supporting DLTs
         */
        export interface TransactionDetails {
            operationId?: string;
            /**
             * Transaction id
             */
            transactionId: string;
            trade?: Trade;
        }
        export interface TransferInstruction {
            type: "transfer";
            asset: Asset;
            source: /* describes destination for remote operations */ AccountInformation;
            destination: /* describes destination for remote operations */ AccountInformation;
            amount: string;
            signature: /* represent a signature template information */ Signature;
        }
        export type TransferOperationDetails = {
            type: "transfer";
            accountRole: string;
        } | null;
        export interface TransferRequestAssetOrderInstruction {
            sourceAccount: AssetInstruction;
            destinationAccount: AssetInstruction;
        }
        /**
         * Settlement information for the issuance request
         */
        export interface TransferRequestSettlement {
            term: AssetTerm;
            instruction: TransferRequestSettlementInstruction;
        }
        export type TransferRequestSettlementInstruction = EscrowSettlement;
        export type Transition = ({
            [key: string]: any;
        } | null) & (InstructionTransition | StatusTransition);
        export interface UpdatePolicyRequest {
            /**
             * unique policy id
             */
            policyId: string;
            /**
             * priority of the policy
             */
            priority: number; // uint32
            intent: "primarySale" | "buyingIntent" | "sellingIntent" | "loanIntent" | "redemptionIntent" | "privateOfferIntent" | "requestForTransferIntent";
            /**
             * description of the policy
             */
            description: string;
            /**
             * whether policy should be applied to all assets
             */
            isDefault?: boolean;
            instructions: Instruction[];
            assetMatchingCriteria: AssetMatchingCriteria;
            constraints?: Constraints;
            /**
             * new version of the trading policy
             */
            version: number; // uint32
        }
        export interface UpdatePolicyResponse {
            /**
             * the updated policy version
             */
            version: number; // uint32
        }
    }
}
declare namespace FinAPIPaths {
    namespace CreatePolicy {
        export type RequestBody = FinAPIComponents.Schemas.CreatePolicyRequest;
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.CreatePolicyResponse;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace DeletePolicyById {
        namespace Parameters {
            export type PolicyId = string;
        }
        export interface PathParameters {
            policyId: Parameters.PolicyId;
        }
        namespace Responses {
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace FindPolicies {
        namespace Parameters {
            export type AssetMatchingType = string;
        }
        export interface QueryParameters {
            assetMatchingType: Parameters.AssetMatchingType;
        }
        namespace Responses {
            export interface $200 {
                policies: FinAPIComponents.Schemas.TradingPolicy[];
            }
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace GetAssetPoliciesByAssetId {
        namespace Parameters {
            export type AssetId = string;
        }
        export interface PathParameters {
            assetId: Parameters.AssetId;
        }
        namespace Responses {
            export interface $200 {
                policies: FinAPIComponents.Schemas.TradingPolicy[];
            }
        }
    }
    namespace GetExecutionPlan {
        namespace Parameters {
            export type PlanId = string;
        }
        export interface PathParameters {
            planId: Parameters.PlanId;
        }
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.Execution;
        }
    }
    namespace GetPolicyById {
        namespace Parameters {
            export type PolicyId = string;
        }
        export interface PathParameters {
            policyId: Parameters.PolicyId;
        }
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.TradingPolicy;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
    namespace ImportTransactions {
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
            transactions: FinAPIComponents.Schemas.Transaction[];
        }
        namespace Responses {
            export interface $200 {
            }
            export interface $208 {
            }
        }
    }
    namespace UpdatePolicy {
        export type RequestBody = FinAPIComponents.Schemas.UpdatePolicyRequest;
        namespace Responses {
            export type $200 = FinAPIComponents.Schemas.UpdatePolicyResponse;
            export type $400 = FinAPIComponents.Schemas.ApiAnyError;
            export type $404 = FinAPIComponents.Schemas.ApiAnyError;
            export type $409 = FinAPIComponents.Schemas.ApiAnyError;
            export type $500 = FinAPIComponents.Schemas.ApiAnyError;
        }
    }
}
