"use client";

import { Activity, KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ApiCredentialCenter } from "./api-credential-center";
import { ChannelReadinessPage } from "./channel-readiness";
import type { OperationsSnapshot } from "./use-operations-snapshot";

type ConnectionSection = "status" | "settings";

export function ChannelConnectionsPage({ notify, channelMetrics, syncStatus, onOpenCs }: {
  notify: (message: string) => void;
  channelMetrics: OperationsSnapshot["channelMetrics"];
  syncStatus: OperationsSnapshot["syncStatus"];
  onOpenCs: (channel: OperationsSnapshot["channelMetrics"][number]["channelKey"]) => void;
}) {
  const [section, setSection] = useState<ConnectionSection>("status");

  return (
    <div className="page-stack channel-connections-page">
      <section className="channel-connections-hero">
        <div>
          <span><ShieldCheck size={14} /> CHANNEL CONNECTION CONTROL</span>
          <h2>연결 상태 확인부터<br /><em>인증 설정까지 한곳에서.</em></h2>
          <p>판매 채널별 준비도, 차단 요인, 운영 API 키와 최근 연결 검사 결과를 한 화면에서 확인하고 관리합니다.</p>
        </div>
        <aside>
          <Activity size={20} />
          <span><b>운영 연결 기준</b><small>판매자 로그인만으로 연결 완료 처리하지 않고, Vault 인증과 실제 읽기 진단 결과를 함께 확인합니다.</small></span>
        </aside>
      </section>

      <div className="connection-section-tabs" aria-label="채널 연결 페이지 구역" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={section === "status"}
          aria-controls="connection-status-panel"
          className={section === "status" ? "active" : ""}
          onClick={() => setSection("status")}
        >
          <ShieldCheck size={17} />
          <span><b>연결 상태</b><small>채널별 준비도와 차단 요인</small></span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "settings"}
          aria-controls="connection-settings-panel"
          className={section === "settings" ? "active" : ""}
          onClick={() => setSection("settings")}
        >
          <KeyRound size={17} />
          <span><b>채널 연결 설정</b><small>API 키, OAuth와 연결 검사</small></span>
        </button>
      </div>

      <section
        id={section === "status" ? "connection-status-panel" : "connection-settings-panel"}
        className="connection-section-panel"
        role="tabpanel"
      >
        {section === "status"
          ? <ChannelReadinessPage embedded channelMetrics={channelMetrics} syncStatus={syncStatus} onOpenCs={onOpenCs} />
          : <ApiCredentialCenter notify={notify} embedded />}
      </section>
    </div>
  );
}
