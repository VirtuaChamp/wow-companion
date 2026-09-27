import { join } from "node:path";

export type CheckoutPaths = {
  dataForeverDir: string;
  areaMapPath: string;
  exporterPath: string;
};

export const resolveCheckoutPaths = (checkoutPath: string, scriptsDir: string): CheckoutPaths => ({
  dataForeverDir: join(checkoutPath, "data", "Forever"),
  areaMapPath: join(checkoutPath, "support", "Forever", "Zones", "areaIdToUiMapId.lua"),
  exporterPath: join(scriptsDir, "build-db", "exporter.lua"),
});
