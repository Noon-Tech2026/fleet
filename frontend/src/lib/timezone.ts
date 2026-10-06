/**
 * Fuseau d'affichage unique : Nouakchott (UTC, sans heure d'ete), quel que soit
 * le reglage de l'ordinateur ou du telephone de l'utilisateur.
 * Charge en premier dans main.tsx. Un timeZone explicite passe en option reste prioritaire.
 */
export const APP_TIME_ZONE = 'Africa/Nouakchott';

type Loc = string | string[] | undefined;
type Opt = Intl.DateTimeFormatOptions | undefined;
const withTz = (o: Opt): Intl.DateTimeFormatOptions => (o && o.timeZone ? o : { ...(o ?? {}), timeZone: APP_TIME_ZONE });

const proto = Date.prototype;
const origString = proto.toLocaleString;
const origDate = proto.toLocaleDateString;
const origTime = proto.toLocaleTimeString;
proto.toLocaleString = function (this: Date, l?: Loc, o?: Opt) { return origString.call(this, l, withTz(o)); };
proto.toLocaleDateString = function (this: Date, l?: Loc, o?: Opt) { return origDate.call(this, l, withTz(o)); };
proto.toLocaleTimeString = function (this: Date, l?: Loc, o?: Opt) { return origTime.call(this, l, withTz(o)); };

const OrigDTF = Intl.DateTimeFormat;
const PatchedDTF = function (l?: Loc, o?: Opt) { return new OrigDTF(l, withTz(o)); } as unknown as typeof Intl.DateTimeFormat;
PatchedDTF.prototype = OrigDTF.prototype;
(PatchedDTF as unknown as { supportedLocalesOf: typeof OrigDTF.supportedLocalesOf }).supportedLocalesOf = OrigDTF.supportedLocalesOf.bind(OrigDTF);
(Intl as unknown as { DateTimeFormat: typeof Intl.DateTimeFormat }).DateTimeFormat = PatchedDTF;
