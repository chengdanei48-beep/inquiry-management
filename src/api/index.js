import { inquiryRoutes } from './inquiries.js';
import { masterRoutes } from './masters.js';
import { reportRoutes } from './reports.js';

/** 全APIのルート。 */
export function createApiRoutes() {
  return [...inquiryRoutes, ...masterRoutes, ...reportRoutes];
}
