export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

export type AccountIdentifier = CryptoWalletAccount | FinP2PAssetAccount | Iban;

export type AccountInstruction = {
  __typename?: 'AccountInstruction';
  /** Asset type associated with the account */
  asset: AssetDetails;
  identifier: AccountIdentifier;
};

/** Apply an aggregation function on specified Object's field. */
export type Aggregate = {
  /** Object's field to which apply the AggregateFunc */
  field?: InputMaybe<Scalars['String']['input']>;
  /** AggregateFunc to apply on the provided Field. */
  func: AggregateFunc;
};

/** Aggregation function to be applied on Object's numeric field. */
export enum AggregateFunc {
  Avg = 'AVG',
  Count = 'COUNT',
  Max = 'MAX',
  Min = 'MIN',
  Sum = 'SUM',
}

/** Result of Aggregation function applied on an Object numeric field. */
export type AggregateResult = {
  __typename?: 'AggregateResult';
  /** The Object's field which this results refer to. */
  field: Scalars['String']['output'];
  /** The AggregateFunc which this AggregateResult refers to. */
  func: AggregateFunc;
  result: Scalars['String']['output'];
};

export enum ApprovalStatus {
  Approved = 'Approved',
  Rejected = 'Rejected',
  Unknown = 'Unknown',
}

/** Represents an Asset in the network. */
export type Asset = Profile & {
  __typename?: 'Asset';
  /** Allowed intent types to be used on the asset */
  allowedIntents?: Maybe<Array<IntentTypes>>;
  /** Collection of certificates associated with the Profile. */
  certificates: Certificates;
  /** Custom configuration for the Asset. */
  config: Scalars['String']['output'];
  /** Denomination currency of the Asset */
  denomination: FiatAsset;
  id: Scalars['String']['output'];
  /** Collection of Intents associated with the Asset. */
  intents: Intents;
  /** Tokens issued for the given Asset. */
  issuedTokens: TokensBalances;
  /** Issuer profile of the Asset. */
  issuerId: Scalars['String']['output'];
  /** Profile metadata, contains ACL information of the profile. */
  metadata: ProfileMetadata;
  name: Scalars['String']['output'];
  /** Organization id to whom this profile is associated with. */
  organizationId: Scalars['String']['output'];
  /** Regulation Verifiers associated with the Asset. */
  regulationVerifiers?: Maybe<Array<Verifier>>;
  /** Type of Asset (Share, Debt etc..) */
  type: Scalars['String']['output'];
};


/** Represents an Asset in the network. */
export type AssetCertificatesArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
};


/** Represents an Asset in the network. */
export type AssetIntentsArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
};


/** Represents an Asset in the network. */
export type AssetIssuedTokensArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
};

export type AssetConversion = {
  __typename?: 'AssetConversion';
  /** Type of accounts */
  accountType?: Maybe<AccountIdentifier>;
  /** List of symbols */
  symbols?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
};

export type AssetDetails = Cryptocurrency | FiatAsset | FinP2PAsset;

export type AssetInstruction = {
  __typename?: 'AssetInstruction';
  account: AccountInstruction;
  destinationAccount?: Maybe<AccountInstruction>;
};

export type AssetIssuer = {
  __typename?: 'AssetIssuer';
  assetId: Scalars['String']['output'];
  issuerId: Scalars['String']['output'];
};

export type AssetOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<AssetOrderField>;
};

export enum AssetOrderField {
  /** Assets order by determined by Name field */
  Name = 'NAME',
  /** Assets order by determined by OrganizationId field */
  Organization = 'ORGANIZATION',
}

export type AssetTerm = {
  __typename?: 'AssetTerm';
  /** Total amount of asset allocated */
  amount: Scalars['String']['output'];
  asset: AssetDetails;
};

export enum AssetType {
  Cryptocurrency = 'cryptocurrency',
  Fiat = 'fiat',
  Finp2p = 'finp2p',
}

/** Results for asset query. */
export type Assets = {
  __typename?: 'Assets';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Asset Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Asset>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

export type Attachment = {
  __typename?: 'Attachment';
  link?: Maybe<Scalars['String']['output']>;
  messageId: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  uuid: Scalars['String']['output'];
};

export type AwaitInstruction = {
  __typename?: 'AwaitInstruction';
  /** epoch time for await instruction */
  waitTime: Scalars['Int']['output'];
};

export type BuyingIntent = {
  __typename?: 'BuyingIntent';
  /** Asset instruction specifies the asset source of destination account of the intent */
  assetInstruction: AssetInstruction;
  /** Asset term specifies the asset information and amount of the intent */
  assetTerm: AssetTerm;
  /** resource id of the buyer */
  buyer?: Maybe<Scalars['String']['output']>;
  settlementInstruction: BuyingSettlementInstruction;
  /** Settlement term */
  settlementTerm: SettlementTerm;
  signaturePolicy: BuyingSignaturePolicy;
  /** Signature policy type */
  signaturePolicyType: SignaturePolicyType;
};

export type BuyingSettlementInstruction = {
  __typename?: 'BuyingSettlementInstruction';
  account: AccountInstruction;
};

export type BuyingSignaturePolicy = ManualIntentSignaturePolicy | PresignedBuyingIntentSignaturePolicy;

/** Represents a Certificate in the network. */
export type Certificate = {
  __typename?: 'Certificate';
  /** Semi-Structured Data provided as additional information for the Certificate. */
  data?: Maybe<Scalars['String']['output']>;
  /** Certificate associated documents metadata. */
  documents: Documents;
  expiry?: Maybe<Scalars['Int']['output']>;
  id: Scalars['String']['output'];
  issuedAt: Scalars['Int']['output'];
  /** Profile to whom this Certificate is associate with. */
  profileId: Scalars['String']['output'];
  /** Service Provider Id which provided the Certificate. */
  providerId: Scalars['String']['output'];
  /** Type of Certificate (KYA,KYC,AML etc.. ). */
  type: Scalars['String']['output'];
};


/** Represents a Certificate in the network. */
export type CertificateDocumentsArgs = {
  filter?: InputMaybe<Array<Filter>>;
};

export type CertificateOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<CertificateOrderField>;
};

export enum CertificateOrderField {
  /** certificates order by determined by Id field */
  Id = 'ID',
}

/** Results for certificates query. */
export type Certificates = {
  __typename?: 'Certificates';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Certificate Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Certificate>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

export type CloseAmountRate = {
  __typename?: 'CloseAmountRate';
  repaymentVolume: Scalars['String']['output'];
};

export type ConvertibleAsset = {
  __typename?: 'ConvertibleAsset';
  /** ISO-4217 code of the fiat currency or other common codes like BTC for cryptocurrencies */
  code?: Maybe<Scalars['String']['output']>;
  /** List of available conversions */
  conversions?: Maybe<Array<Maybe<AssetConversion>>>;
  /** Type of the asset */
  type?: Maybe<AssetType>;
};

export type Correspondent = AssetIssuer;

export type CryptoWalletAccount = {
  __typename?: 'CryptoWalletAccount';
  /** Wallet address represented as a hexadecimal string prefixed with 0x */
  address: Scalars['String']['output'];
};

export type Cryptocurrency = {
  __typename?: 'Cryptocurrency';
  /** Symbol of the Cryptocurrnecy */
  symbol: Scalars['String']['output'];
};

export type Custodian = {
  __typename?: 'Custodian';
  orgId?: Maybe<Scalars['String']['output']>;
};

export type Delivered = {
  __typename?: 'Delivered';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type DeliveryStatus = Delivered | NotDelivered | PendingDelivery;

/** Certificate related Document metadata informaiton */
export type Document = {
  __typename?: 'Document';
  id: Scalars['String']['output'];
  mimeType: Scalars['String']['output'];
  name: Scalars['String']['output'];
  /** Locaiton of document content. */
  uri: Scalars['String']['output'];
};

/** Results for documents query. */
export type Documents = {
  __typename?: 'Documents';
  /** Collection of Document Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Document>>;
};

export type ErrorState = {
  __typename?: 'ErrorState';
  code: Scalars['Int']['output'];
  message: Scalars['String']['output'];
};

/** Represents an Escrow in the network. */
export type Escrow = {
  __typename?: 'Escrow';
  /** FinP2P Organization Id of the Escrow */
  orgId: Scalars['String']['output'];
  /** Payment Asset */
  paymentAsset: PaymentAsset;
};

export type Escrows = {
  __typename?: 'Escrows';
  /** Collection of escrow Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Escrow>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

export type ExecutionContext = {
  __typename?: 'ExecutionContext';
  /** ExecutionPlan associated with the transaction */
  executionPlanId?: Maybe<Scalars['String']['output']>;
  /** The associated instruction sequence number */
  instructionSequenceNumber?: Maybe<Scalars['Int']['output']>;
};

/** Information about organization in an Execution Plan context */
export type ExecutionOrganization = {
  __typename?: 'ExecutionOrganization';
  organizationId: Scalars['String']['output'];
};

export type ExecutionPlan = {
  __typename?: 'ExecutionPlan';
  /** list of plan approvals */
  approvals: Array<Maybe<PlanApproval>>;
  /** plan creation (timestamp in sec) */
  creationTimestamp: Scalars['Int']['output'];
  /** resource id of execution plan */
  id: Scalars['String']['output'];
  /** plan's list of instructions */
  instructions: Array<Maybe<ExecutionPlanInstruction>>;
  /** Intent associated with execution plan */
  intent?: Maybe<Intent>;
  /** last time plan was modified (epoch time seconds) */
  lastModified: Scalars['Int']['output'];
  /** organizations which participate in the execution plan */
  organizations: Array<ExecutionOrganization>;
  /** lifecycle status of the execution plan */
  status: ExecutionPlanStatus;
};

export type ExecutionPlanInstruction = {
  __typename?: 'ExecutionPlanInstruction';
  approvals: InstructionApprovals;
  details: InstructionDetails;
  organizations: Array<ExecutionOrganization>;
  sequence: Scalars['Int']['output'];
  state: InstructionCompletionState;
  status: ExecutionPlanInstructionStatus;
};


export type ExecutionPlanInstructionApprovalsArgs = {
  filter?: InputMaybe<Array<Filter>>;
};

export enum ExecutionPlanInstructionStatus {
  Approved = 'Approved',
  Completed = 'Completed',
  Failed = 'Failed',
  Pending = 'Pending',
  Unknown = 'Unknown',
}

export type ExecutionPlanInstructions = {
  __typename?: 'ExecutionPlanInstructions';
  nodes?: Maybe<Array<ExecutionPlanInstruction>>;
};

export type ExecutionPlanOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<ExecutionPlanOrderField>;
};

export enum ExecutionPlanOrderField {
  CreationTimestamp = 'CREATION_TIMESTAMP',
  /** plan order by PlanId field */
  PlanId = 'PLAN_ID',
}

export enum ExecutionPlanStatus {
  Approved = 'Approved',
  Completed = 'Completed',
  Failed = 'Failed',
  Halted = 'Halted',
  InProgress = 'InProgress',
  Pending = 'Pending',
  Rejected = 'Rejected',
  Unknown = 'Unknown',
}

export type ExecutionsPlans = {
  __typename?: 'ExecutionsPlans';
  nodes?: Maybe<Array<ExecutionPlan>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

export type FiatAsset = {
  __typename?: 'FiatAsset';
  /** ISO-4217 code of the fiat currency */
  code: Scalars['String']['output'];
};

/**
 * Filter capabilities that can be applied on queries which return multiple results of a given Entity.
 * Currently filtering is available only on the fields which belongs to the Root of the entity
 * and not on nested entities' fields.
 */
export type Filter = {
  /** The Object's key to which apply the filter rule. */
  key: Scalars['String']['input'];
  /** Operator to apply on the specified key and provided value. */
  operator: Operator;
  /** The Value to be used by the Filter Operator. */
  value: Scalars['String']['input'];
};

export type FinP2PAccount = {
  __typename?: 'FinP2PAccount';
  custodian: Custodian;
  finId: Scalars['String']['output'];
};

export type FinP2PAsset = {
  __typename?: 'FinP2PAsset';
  /** Resource ID of the FinP2P asset */
  resourceId: Scalars['String']['output'];
};

export type FinP2PAssetAccount = {
  __typename?: 'FinP2PAssetAccount';
  /** FinId -- a user's public key represented as a hexadecimal string, associated with a user on the FinP2P network */
  finId: Scalars['String']['output'];
  /** organization id of the Asset's source ledger, the Asset's organization */
  orgId: Scalars['String']['output'];
};

export type HoldInstruction = {
  __typename?: 'HoldInstruction';
  /** asset's hold amount */
  amount: Scalars['String']['output'];
  /** resource id of the destination user */
  destination: Scalars['String']['output'];
  /** destination account information */
  destinationAccount: AccountInstruction;
  /** resource id of the source user */
  source: Scalars['String']['output'];
  /** source account information */
  sourceAccount: AccountInstruction;
};

export type Holding = {
  __typename?: 'Holding';
  account: FinP2PAssetAccount;
  asset: AssetDetails;
  assetType: AssetType;
  availableBalance: Scalars['String']['output'];
  balance: Scalars['String']['output'];
  withheldBalance: Scalars['String']['output'];
};

export type Holdings = {
  __typename?: 'Holdings';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Funds balance objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Holding>>;
};

export type Iban = {
  __typename?: 'Iban';
  /** IBAN code */
  code: Scalars['String']['output'];
};

export type IncomingMessage = {
  __typename?: 'IncomingMessage';
  message?: Maybe<Message>;
};

export type InstructionApproval = {
  __typename?: 'InstructionApproval';
  orgId: Scalars['String']['output'];
  planId: Scalars['String']['output'];
  sequence: Scalars['Int']['output'];
  status: Scalars['String']['output'];
};

/** Results for Instruction Approval query. */
export type InstructionApprovals = {
  __typename?: 'InstructionApprovals';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Instruction Approval Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<InstructionApproval>>;
};

export type InstructionCompletionState = ErrorState | SuccessState | UnknownState;

export type InstructionDetails = AwaitInstruction | HoldInstruction | IssueInstruction | ReleaseInstruction | RevertHoldInstruction | TransferInstruction;

/** Represent an Asset's Transaction Intent occasion in which the Asset's tokens are issued. */
export type Intent = {
  __typename?: 'Intent';
  /** End time of the intent. */
  end: Scalars['Int']['output'];
  id: Scalars['String']['output'];
  /** Intent data */
  intent?: Maybe<IntentDetails>;
  /** Remaining quantity in the transaction. */
  remainingQuantity: Scalars['String']['output'];
  /** Start time of the intent. */
  start: Scalars['Int']['output'];
  /** Intent status */
  status: IntentStatus;
  /** Intent type: primary sale, buying or selling intent */
  type: Scalars['String']['output'];
};

export type IntentDetails = BuyingIntent | LoanIntent | PrimarySale | SellingIntent;

export enum IntentStatus {
  Active = 'ACTIVE',
  Cancelled = 'CANCELLED',
  NonActive = 'NON_ACTIVE',
}

export enum IntentTypes {
  Buying = 'BUYING',
  Loan = 'LOAN',
  PrimarySale = 'PRIMARY_SALE',
  Selling = 'SELLING',
}

/** Results for itents query. */
export type Intents = {
  __typename?: 'Intents';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Intent Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Intent>>;
};

export type InterestRate = {
  __typename?: 'InterestRate';
  annualPercentageRate: Scalars['String']['output'];
};

export type Investor = {
  __typename?: 'Investor';
  resourceId: Scalars['String']['output'];
};

export type IssueInstruction = {
  __typename?: 'IssueInstruction';
  /** asset's issuance amount */
  amount: Scalars['String']['output'];
  /** resource id of the buyer */
  buyer: Scalars['String']['output'];
  /** buyer's account */
  destinationAccount: AccountInstruction;
};

/** Represents an Issuer in the network. */
export type Issuer = {
  __typename?: 'Issuer';
  /** Assets issued by the Issuer. */
  assets: Assets;
  id: Scalars['String']['output'];
  outbox?: Maybe<OutgoingMessages>;
};


/** Represents an Issuer in the network. */
export type IssuerAssetsArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};


/** Represents an Issuer in the network. */
export type IssuerOutboxArgs = {
  filter?: InputMaybe<Array<Filter>>;
};

export type IssuerOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<IssuerOrderField>;
};

export enum IssuerOrderField {
  /** issuers order by determined by Id field */
  Id = 'ID',
}

/** Results for issuers query. */
export type Issuers = {
  __typename?: 'Issuers';
  /** Collection of Issuer Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Issuer>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

export type LoanAssetInstruction = {
  __typename?: 'LoanAssetInstruction';
  borrowerAccount: AccountInstruction;
  lenderAccount: AccountInstruction;
};

export type LoanConditions = CloseAmountRate | InterestRate | RepaymentTerm;

export type LoanInstruction = {
  __typename?: 'LoanInstruction';
  closeDate: Scalars['Int']['output'];
  loanConditions: LoanConditions;
  openDate: Scalars['Int']['output'];
};

export type LoanIntent = {
  __typename?: 'LoanIntent';
  /** Asset instruction specifies the asset source of destination account of the intent */
  assetInstruction: LoanAssetInstruction;
  /** Asset term specifies the asset information and amount of the intent */
  assetTerm: AssetTerm;
  /** resource id of the borrower */
  borrower: Scalars['String']['output'];
  /** resource id of the lender */
  lender: Scalars['String']['output'];
  loanInstruction: LoanInstruction;
  /** Signature policy type */
  loanSettlementInstruction: LoanSettlementInstruction;
  /** Settlement term */
  settlementTerm: SettlementTerm;
  signaturePolicy: LoanSignaturePolicy;
  signaturePolicyType: SignaturePolicyType;
};

export type LoanSettlementInstruction = {
  __typename?: 'LoanSettlementInstruction';
  borrowerAccount?: Maybe<AccountIdentifier>;
  lenderAccount?: Maybe<AccountIdentifier>;
};

export type LoanSignaturePolicy = PresignedLoanIntentSignaturePolicy;

export type ManualIntentSignaturePolicy = {
  __typename?: 'ManualIntentSignaturePolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type Message = {
  __typename?: 'Message';
  attachments: Array<Attachment>;
  body: Scalars['String']['output'];
  correspondent: Correspondent;
  id: Scalars['String']['output'];
  subject: Scalars['String']['output'];
  timestamp: Scalars['String']['output'];
};

export type MessageRecipient = {
  __typename?: 'MessageRecipient';
  deliveryStatus?: Maybe<DeliveryStatus>;
  destination: Recipient;
};

export type MessageRecipients = {
  __typename?: 'MessageRecipients';
  /** Collection of User Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<MessageRecipient>>;
};

export type Messages = {
  __typename?: 'Messages';
  nodes?: Maybe<Array<Message>>;
};

export type NotDelivered = {
  __typename?: 'NotDelivered';
  status: Scalars['String']['output'];
};

export enum OperationType {
  Hold = 'Hold',
  Issue = 'Issue',
  Redeem = 'Redeem',
  Release = 'Release',
  Transfer = 'Transfer',
  Unknown = 'Unknown',
}

/** Operators available to be used  */
export enum Operator {
  /** Contains */
  Contains = 'CONTAINS',
  /** Equals */
  Eq = 'EQ',
  /** Greater Than */
  Gt = 'GT',
  /** Greater Than or Equals */
  Gte = 'GTE',
  /** In */
  In = 'IN',
  /** Less Than */
  Lt = 'LT',
  /** Less Than or Equals */
  Lte = 'LTE',
  /** Not Equals */
  Neq = 'NEQ',
  /** Not In */
  Nin = 'NIN',
}

/** Organization's information. */
export type Organization = {
  __typename?: 'Organization';
  /** Assets which the Organization act as the Primary Node. */
  assets: Assets;
  /** Organization's cluster id. */
  clusterId: Scalars['String']['output'];
  /** Organization's finp2p public key represented as a hexadecimal string. */
  finId: Scalars['String']['output'];
  id: Scalars['String']['output'];
  /** Organization's name on the finp2p network. */
  name: Scalars['String']['output'];
  /** Organization's supported types, e.g. Primary, Escrow */
  types?: Maybe<Array<Scalars['String']['output']>>;
  /** Users which the Organization act as the Primary Node. */
  users: Users;
};


/** Organization's information. */
export type OrganizationAssetsArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};


/** Organization's information. */
export type OrganizationUsersArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};

export type OrganizationAsset = {
  __typename?: 'OrganizationAsset';
  asset: Asset;
  metadata: ProfileMetadata;
};

export type OrganizationOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<OrganizationOrderField>;
};

export enum OrganizationOrderField {
  /** organizations order by determined by Id field */
  Id = 'ID',
}

/** Results for Organization query. */
export type Organizations = {
  __typename?: 'Organizations';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Organization Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Organization>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

export type OutgoingMessage = {
  __typename?: 'OutgoingMessage';
  message?: Maybe<Message>;
  recipients: MessageRecipients;
};


export type OutgoingMessageRecipientsArgs = {
  filter?: InputMaybe<Array<Filter>>;
};

export type OutgoingMessages = {
  __typename?: 'OutgoingMessages';
  nodes?: Maybe<Array<OutgoingMessage>>;
};

export type PageInfo = {
  __typename?: 'PageInfo';
  /** Cursor for the end of the current page */
  endCursor?: Maybe<Scalars['String']['output']>;
  /** Indicates if there are more items after the current page */
  hasNextPage: Scalars['Boolean']['output'];
  /** Total count of items */
  totalCount: Scalars['Int']['output'];
  /** Total count of items left to be presented */
  totalLeft: Scalars['Int']['output'];
};

export type PaginateInput = {
  /** Cursor field to return records after it */
  after?: InputMaybe<Scalars['String']['input']>;
  /** Number of records to return in response */
  limit?: InputMaybe<Scalars['Int']['input']>;
  /** Number of pages to skip to get new cursor */
  skip?: InputMaybe<Scalars['Int']['input']>;
};

/** Represents supported asset types and conversions in Escrow. */
export type PaymentAsset = {
  __typename?: 'PaymentAsset';
  /** Type of account, f.e.: 'Escrow' */
  accountType?: Maybe<Scalars['String']['output']>;
  /** List of supported assets */
  assets?: Maybe<Array<Maybe<ConvertibleAsset>>>;
  /** PaymentAsset id */
  id?: Maybe<Scalars['String']['output']>;
};

export type PendingDelivery = {
  __typename?: 'PendingDelivery';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type PlanApproval = {
  __typename?: 'PlanApproval';
  orgId: Scalars['String']['output'];
  planId: Scalars['String']['output'];
  status: ApprovalStatus;
  statusInfo: PlanApprovalStatusInfo;
};

export type PlanApprovalStatusInfo = {
  __typename?: 'PlanApprovalStatusInfo';
  code: Scalars['Int']['output'];
  message: Scalars['String']['output'];
};

/** Results for Plan Approval query. */
export type PlanApprovals = {
  __typename?: 'PlanApprovals';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Plan Approval Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<PlanApproval>>;
};

/** Fields to subscribe on */
export enum PlanField {
  Status = 'Status',
}

export type PresignedBuyingIntentSignaturePolicy = {
  __typename?: 'PresignedBuyingIntentSignaturePolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type PresignedLoanIntentSignaturePolicy = {
  __typename?: 'PresignedLoanIntentSignaturePolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type PresignedSellingIntentSignaturePolicy = {
  __typename?: 'PresignedSellingIntentSignaturePolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type PrimarySale = {
  __typename?: 'PrimarySale';
  /** Asset instruction specifies the asset source of destination account of the intent */
  assetInstruction: AssetInstruction;
  /** Asset term specifies the asset information and amount of the intent */
  assetTerm: AssetTerm;
  /** Issuer id */
  issuerId: Scalars['String']['output'];
  sellingSettlementInstruction: SellingSettlementInstruction;
  /** Settlement term */
  settlementTerm: SettlementTerm;
};

/** Profile interface. */
export type Profile = {
  /** Collection of certificates associated with the Profile. */
  certificates: Certificates;
  id: Scalars['String']['output'];
  /** Profile metadata, contains ACL information of the profile. */
  metadata: ProfileMetadata;
  /** Organization id to which this profile is associated with. */
  organizationId: Scalars['String']['output'];
};


/** Profile interface. */
export type ProfileCertificatesArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
};

/** Profile Metadata (ACL). */
export type ProfileMetadata = {
  __typename?: 'ProfileMetadata';
  acl?: Maybe<Array<Scalars['String']['output']>>;
};

/** The query root of Ownera's GraphQL interface. */
export type Query = {
  __typename?: 'Query';
  /** Look up Assets, Optional provide Filters or Aggregates. */
  assets: Assets;
  /** Look up Certificates, Optional provide Filter or Aggregate. */
  certificates: Certificates;
  /** List of escrows */
  escrows: Escrows;
  /** Look up Issuers, Optional provide Filter. */
  issuers: Issuers;
  /** Look up Organizations, Optional provide Filter or Aggregate. */
  organizations: Organizations;
  /** Look up Execution Plans, Optional provide Filter. */
  plans: ExecutionsPlans;
  /** Look up a receipt by a Filter (mandatory). */
  receipts: Receipts;
  /** Look up Users, Optional provide Filter or Aggregate. */
  users: Users;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryAssetsArgs = {
  aggregate?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  orderBy?: InputMaybe<AssetOrder>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryCertificatesArgs = {
  aggregate?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryEscrowsArgs = {
  filter?: InputMaybe<Array<Filter>>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryIssuersArgs = {
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryOrganizationsArgs = {
  aggregate?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryPlansArgs = {
  filter?: InputMaybe<Array<Filter>>;
  orderBy?: InputMaybe<ExecutionPlanOrder>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryReceiptsArgs = {
  filter?: InputMaybe<Array<InputMaybe<Filter>>>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryUsersArgs = {
  aggregate?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};

export type Receipt = {
  __typename?: 'Receipt';
  /** Asset type related to holding updated */
  asset: AssetDetails;
  /** Account related to destination of transaction */
  destination: User;
  /** Account related to destination of transaction */
  destinationAccount?: Maybe<AccountIdentifier>;
  id: Scalars['String']['output'];
  /** Operation id */
  operationId?: Maybe<Scalars['String']['output']>;
  /** Operation type */
  operationType?: Maybe<OperationType>;
  /** Number of asset units with the transaction */
  quantity: Scalars['String']['output'];
  /** User  related to source of transaction */
  source: User;
  /** Account related to source of transaction */
  sourceAccount?: Maybe<AccountIdentifier>;
  /** Receipt timestamp */
  timestamp: Scalars['String']['output'];
  /** Trade details associated with the transaction */
  tradeDetails?: Maybe<TradeDetails>;
  /** Underlying transaction id */
  transactionId?: Maybe<Scalars['String']['output']>;
};

export type ReceiptOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<ReceiptOrderField>;
};

export enum ReceiptOrderField {
  /** receipt order by determined by Id field */
  Id = 'ID',
}

export type ReceiptState = {
  __typename?: 'ReceiptState';
  receipt: Receipt;
};

/** Results for receipts query. */
export type Receipts = {
  __typename?: 'Receipts';
  /** Collection of Receipt Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Receipt>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

export type Recipient = Investor;

export type ReleaseInstruction = {
  __typename?: 'ReleaseInstruction';
  /** asset's release amount */
  amount: Scalars['String']['output'];
  /** destination account information */
  destinationAccount: AccountInstruction;
  /** source account information */
  sourceAccount: AccountInstruction;
};

export type RepaymentTerm = {
  __typename?: 'RepaymentTerm';
  annualPercentageRate?: Maybe<Scalars['String']['output']>;
  repaymentVolume: Scalars['String']['output'];
};

export type RevertHoldInstruction = {
  __typename?: 'RevertHoldInstruction';
  /** destination account information */
  destinationAccount: AccountInstruction;
};

export type SellingIntent = {
  __typename?: 'SellingIntent';
  /** Asset instruction specifies the asset source of destination account of the intent */
  assetInstruction: AssetInstruction;
  /** Asset term specifies the asset information and amount of the intent */
  assetTerm: AssetTerm;
  /** resource id of the seller */
  seller?: Maybe<Scalars['String']['output']>;
  sellingSettlementInstruction: SellingSettlementInstruction;
  /** Settlement term */
  settlementTerm: SettlementTerm;
  signaturePolicy: SellingSignaturePolicy;
  /** Signature policy type */
  signaturePolicyType: SignaturePolicyType;
};

export type SellingSettlementInstruction = {
  __typename?: 'SellingSettlementInstruction';
  accounts?: Maybe<Array<AccountInstruction>>;
};

export type SellingSignaturePolicy = ManualIntentSignaturePolicy | PresignedSellingIntentSignaturePolicy;

export type SettlementInstruction = {
  __typename?: 'SettlementInstruction';
  details: SettlementInstructionTypeDetails;
};

export type SettlementInstructionTypeDetails = BuyingSettlementInstruction | SellingSettlementInstruction;

export type SettlementTerm = {
  __typename?: 'SettlementTerm';
  asset: AssetDetails;
  unitValue: Scalars['String']['output'];
};

export enum SignaturePolicyType {
  ManualPolicy = 'ManualPolicy',
  PresignedPolicy = 'PresignedPolicy',
}

export enum SortOrder {
  Asc = 'ASC',
  Desc = 'DESC',
}

export type Subscription = {
  __typename?: 'Subscription';
  planAdded: ExecutionPlan;
  plansChangedBy: ExecutionPlan;
  receiptAdded: Receipt;
};


export type SubscriptionPlansChangedByArgs = {
  fieldNames: Array<PlanField>;
};

export type SuccessState = {
  __typename?: 'SuccessState';
  output?: Maybe<SuccessStateOutput>;
};

export type SuccessStateOutput = Receipt;

/** Represents an Asset token balance information. */
export type TokenBalance = {
  __typename?: 'TokenBalance';
  assetId: Scalars['String']['output'];
  quantity: Scalars['String']['output'];
  transactionsDetails?: Maybe<Array<TransactionDetails>>;
  userId: Scalars['String']['output'];
};

/** Results for tokens query. */
export type TokensBalances = {
  __typename?: 'TokensBalances';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Token Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<TokenBalance>>;
};

export type TradeDetails = {
  __typename?: 'TradeDetails';
  /** Details of ExecutionPlan associated with the transaction */
  executionContext?: Maybe<ExecutionContext>;
  /** Intent  associated with the transaction */
  intent?: Maybe<Intent>;
};

export type TransactionDetails = {
  __typename?: 'TransactionDetails';
  index: Scalars['Int']['output'];
  quantity: Scalars['String']['output'];
  transactionId: Scalars['String']['output'];
};

export type TransferInstruction = {
  __typename?: 'TransferInstruction';
  /** asset's transfer amount */
  amount: Scalars['String']['output'];
  /** resource id of the destination */
  destination: Scalars['String']['output'];
  /** destination account information */
  destinationAccount: AccountInstruction;
  /** resource id of the source */
  source: Scalars['String']['output'];
  /** source account information */
  sourceAccount: AccountInstruction;
};

export type UnknownState = {
  __typename?: 'UnknownState';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

/** Represents an User in the network. */
export type User = Profile & {
  __typename?: 'User';
  accounts?: Maybe<Array<FinP2PAccount>>;
  /** Collection of certificates associated with the Profile. */
  certificates: Certificates;
  /** finIds keys associated with this investor */
  finIds?: Maybe<Array<Scalars['String']['output']>>;
  holdings: Holdings;
  id: Scalars['String']['output'];
  /** User's associated messages */
  inbox: Messages;
  /** Profile metadata, contains ACL information of the profile. */
  metadata: ProfileMetadata;
  name: Scalars['String']['output'];
  /** Organization id to whom this profile is associated with. */
  organizationId: Scalars['String']['output'];
};


/** Represents an User in the network. */
export type UserAccountsArgs = {
  filter?: InputMaybe<Array<Filter>>;
};


/** Represents an User in the network. */
export type UserCertificatesArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
};


/** Represents an User in the network. */
export type UserHoldingsArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
};


/** Represents an User in the network. */
export type UserInboxArgs = {
  filter?: InputMaybe<Array<Filter>>;
};

export type UserOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<UserOrderField>;
};

export enum UserOrderField {
  /** users order by determined by Id field */
  Id = 'ID',
}

/** Results for asset query. */
export type Users = {
  __typename?: 'Users';
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of User Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<User>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

/** Regulation Verifier */
export type Verifier = {
  __typename?: 'Verifier';
  /** Verifier ID */
  id?: Maybe<Scalars['String']['output']>;
  /** Verifier Name */
  name?: Maybe<Scalars['String']['output']>;
  /** Provider type: REG_APP_STORE, OTHER */
  provider?: Maybe<Scalars['String']['output']>;
};
