import { inquiryRoutes } from './inquiries.js';
import { masterRoutes } from './masters.js';

/** 全APIのルート。集計・CSV・月次保存はフェーズ5で追加する。 */
export function createApiRoutes() {
  return [...inquiryRoutes, ...masterRoutes];
}
