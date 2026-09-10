"use client";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useShippingWorkspace } from "./use-workspace";
import { displayShippingOrders } from "./display-orders";
import { OrdersPage } from "./workspace";
import styles from "./standalone-workspace.module.css";
export function ShippingStandaloneWorkspace() {
  const [notice, setNotice] = useState("");
  const notify = useCallback((message: string) => setNotice(message), []);
  const shipping = useShippingWorkspace({ notify, active: true });
  const orders = useMemo(
    () => displayShippingOrders(shipping.snapshot),
    [shipping.snapshot],
  );
  return (
    <main className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <h1>주문·배송</h1>
          <p>주문 조회와 송장·발송 처리를 관리합니다.</p>
        </div>
        <nav>
          <Link href="/?view=products" prefetch={false}>
            상품 관리
          </Link>{" "}
          ·{" "}
          <Link href="/cs" prefetch={false}>
            고객 문의
          </Link>
        </nav>
      </header>
      {notice && (
        <div role="status" className={styles.notice}>
          {notice}
          <button type="button" onClick={() => setNotice("")}>
            알림 닫기
          </button>
        </div>
      )}
      {shipping.loading && !shipping.snapshot && (
        <p role="status">주문 데이터를 불러오고 있습니다.</p>
      )}
      {shipping.error && (
        <div role="alert" className={styles.status}>
          <h2>배송 연결 확인이 필요합니다</h2>
          <p>{shipping.error}</p>
          <button type="button" onClick={() => void shipping.reload()}>
            다시 불러오기
          </button>{" "}
          <Link href="/" prefetch={false}>
            로그인 확인
          </Link>
        </div>
      )}
      {shipping.snapshot && (
        <OrdersPage
          notify={notify}
          displayOrders={orders}
          onFulfill={shipping.fulfillOrders}
          syncStatus={shipping.snapshot.syncStatus}
        />
      )}
    </main>
  );
}
