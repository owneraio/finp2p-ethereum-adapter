


enum LegType {
    ASSET,
    SETTLEMENT
}

enum PrimaryType {
    PRIMARY_SALE,
    BUYING,
    SELLING,
    REDEMPTION,
    TRANSFER,
    PRIVATE_OFFER,
    LOAN
}

enum Phase {
    INITIATE,
    CLOSE
}

enum ReleaseType {
    RELEASE,
    REDEEM
}

struct OperationParams {
    LegType leg;
    Phase phase;
    PrimaryType eip712PrimaryType;
    string operationId;
    ReleaseType releaseType;
}
