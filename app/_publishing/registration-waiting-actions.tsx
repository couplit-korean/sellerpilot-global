"use client";
import { Plus } from "lucide-react";
export function RegistrationWaitingActions({ canLeaveWaiting, acceptedActivity, controllingActivity, onAdditional, onBack, onHistory, onStop, onDelete }: {
  canLeaveWaiting: boolean; acceptedActivity: boolean; controllingActivity: boolean;
  onAdditional: () => void; onBack: () => void; onHistory: () => void; onStop: () => void; onDelete: () => void;
}) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }} aria-label="상품 작업 대기 중 선택">
    <button type="button" className="primary-button" onClick={onAdditional} disabled={controllingActivity || !canLeaveWaiting}><Plus size={15} />추가 상품 등록</button>
    <button type="button" className="credential-secondary" onClick={onBack} disabled={controllingActivity || !canLeaveWaiting}>이전 화면</button>
    <button type="button" className="credential-secondary" onClick={onHistory} disabled={controllingActivity || !canLeaveWaiting}>진행상황 보기</button>
    <button type="button" className="registration-stop-button" onClick={onStop} disabled={controllingActivity || !acceptedActivity}>중지</button>
    <button type="button" className="registration-stop-button" onClick={onDelete} disabled={controllingActivity || !acceptedActivity}>삭제</button>
    {!canLeaveWaiting && <small>자료를 서버에 접수하면 이동·중지·삭제할 수 있습니다.</small>}
  </div>;
}
