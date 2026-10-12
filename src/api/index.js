import { inquiryRoutes } from './inquiries.js';

/** 全APIのルート。マスタ・集計はフェーズ4・5で追加する。 */
export function createApiRoutes() {
  return [...inquiryRoutes];
}
