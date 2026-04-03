"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReleaseType = exports.Phase = exports.PrimaryType = exports.LegType = void 0;
/**
 * Operation context — mirrors the on-chain OperationParams struct.
 * Carries the business semantics of an operation so token standards
 * can vary behavior based on leg, phase, and primary type.
 *
 * For REPO/Loan flows, Phase is critical:
 * - INITIATE: collateral pledged, cash lent
 * - CLOSE: collateral returned, cash + rebate repaid
 */
var LegType;
(function (LegType) {
    LegType[LegType["Asset"] = 0] = "Asset";
    LegType[LegType["Settlement"] = 1] = "Settlement";
})(LegType || (exports.LegType = LegType = {}));
var PrimaryType;
(function (PrimaryType) {
    PrimaryType[PrimaryType["PrimarySale"] = 0] = "PrimarySale";
    PrimaryType[PrimaryType["Buying"] = 1] = "Buying";
    PrimaryType[PrimaryType["Selling"] = 2] = "Selling";
    PrimaryType[PrimaryType["Redemption"] = 3] = "Redemption";
    PrimaryType[PrimaryType["Transfer"] = 4] = "Transfer";
    PrimaryType[PrimaryType["PrivateOffer"] = 5] = "PrivateOffer";
    PrimaryType[PrimaryType["Loan"] = 6] = "Loan";
})(PrimaryType || (exports.PrimaryType = PrimaryType = {}));
var Phase;
(function (Phase) {
    Phase[Phase["Initiate"] = 0] = "Initiate";
    Phase[Phase["Close"] = 1] = "Close";
})(Phase || (exports.Phase = Phase = {}));
var ReleaseType;
(function (ReleaseType) {
    ReleaseType[ReleaseType["Release"] = 0] = "Release";
    ReleaseType[ReleaseType["Redeem"] = 1] = "Redeem";
})(ReleaseType || (exports.ReleaseType = ReleaseType = {}));
//# sourceMappingURL=types.js.map