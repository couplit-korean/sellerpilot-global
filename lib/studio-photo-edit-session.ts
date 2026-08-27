export function createStudioPhotoEditSession<Photo>() {
  let currentSessionId = 0;
  let photos: Photo[] = [];
  let processing = false;

  const start = () => {
    currentSessionId += 1;
    photos = [];
    processing = false;
    return currentSessionId;
  };

  const invalidate = () => {
    currentSessionId += 1;
    photos = [];
    processing = false;
    return currentSessionId;
  };

  const isCurrent = (sessionId: number) => sessionId === currentSessionId;

  const updatePhotos = (sessionId: number, nextPhotos: readonly Photo[]) => {
    if (!isCurrent(sessionId)) return false;
    photos = [...nextPhotos];
    return true;
  };

  const updateProcessing = (sessionId: number, nextProcessing: boolean) => {
    if (!isCurrent(sessionId)) return false;
    processing = nextProcessing;
    return true;
  };

  const snapshot = () => ({
    sessionId: currentSessionId,
    photos: [...photos],
    processing,
  });

  return {
    start,
    invalidate,
    isCurrent,
    updatePhotos,
    updateProcessing,
    snapshot,
  };
}
