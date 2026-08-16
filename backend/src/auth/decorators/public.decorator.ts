import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

/** Ouvre une route a un visiteur non authentifie. A utiliser avec parcimonie. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
