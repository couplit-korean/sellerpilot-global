export type CategoryTargetSelectionRequest = {
  signal: AbortSignal;
  isCurrent: () => boolean;
  complete: () => void;
};

export class CategoryTargetSelectionCoordinator {
  private generation = 0;
  private controller: AbortController | null = null;
  private disposed = false;

  begin(): CategoryTargetSelectionRequest {
    this.supersede(new DOMException("더 최신 판매 국가 선택으로 교체되었습니다.", "AbortError"));
    this.disposed = false;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const isCurrent = () => !this.disposed
      && !controller.signal.aborted
      && this.generation === generation
      && this.controller === controller;
    return {
      signal: controller.signal,
      isCurrent,
      complete: () => {
        if (this.controller === controller) this.controller = null;
      },
    };
  }

  supersede(reason = new DOMException("판매 국가 선택이 변경되었습니다.", "AbortError")) {
    this.generation += 1;
    this.controller?.abort(reason);
    this.controller = null;
  }

  dispose() {
    this.disposed = true;
    this.supersede(new DOMException("채널 등록 준비 화면이 닫혔습니다.", "AbortError"));
  }
}
