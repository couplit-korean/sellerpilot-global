/** One claim records its external-write boundary once, even across media and listing writes. */
export function createGatewayMutationBoundary({ assertLeaseHealthy, persist, onStarted, reuseRegistration = false }) {
  let registration;
  return async () => {
    await assertLeaseHealthy();
    const register = async () => {
      await persist();
      onStarted();
    };
    if (reuseRegistration) {
      registration ??= register();
      await registration;
    } else {
      await register();
    }
    await assertLeaseHealthy();
  };
}
