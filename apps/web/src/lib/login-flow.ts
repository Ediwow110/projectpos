import { waitForApiReady, type ReadinessOptions } from "./login-readiness";

export interface LoginFlowOptions<T> extends ReadinessOptions {
  login: () => Promise<T>;
  onReady?: () => void;
}

export async function loginWithReadiness<T>(options: LoginFlowOptions<T>): Promise<T> {
  await waitForApiReady(options);
  options.onReady?.();
  return options.login();
}
