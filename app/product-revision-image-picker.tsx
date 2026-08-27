"use client";

import Image from "next/image";
import { Camera, ImagePlus, LoaderCircle, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StudioPhoto } from "./ai-product-studio";
import { settleWithConcurrency } from "../lib/promise-pool";
import { withPromiseTimeout } from "../lib/promise-timeout";
import { createRevisionPhotoSelectionFence, releaseStaleRevisionPhoto } from "../lib/product-revision-photo-fence";
import { assertStudioSourceDimensions, assertStudioSourceFile } from "../lib/studio-source-photo-policy";

const revisionPhotoRoles = [
  { id: "front", label: "정면" },
  { id: "back", label: "후면" },
  { id: "left", label: "좌측면" },
  { id: "right", label: "우측면" },
  { id: "top", label: "상단" },
  { id: "bottom", label: "하단" },
  { id: "label", label: "성분·라벨" },
  { id: "barcode", label: "바코드" },
] as const;

export function ProductRevisionImagePicker({ disabled, onChange, onError }: {
  disabled: boolean;
  onChange: (photos: StudioPhoto[]) => void;
  onError: (message: string) => void;
}) {
  const [mainPhoto, setMainPhoto] = useState<StudioPhoto | null>(null);
  const [rolePhotos, setRolePhotos] = useState<Record<string, StudioPhoto>>({});
  const [extraPhotos, setExtraPhotos] = useState<StudioPhoto[]>([]);
  const [processing, setProcessing] = useState(false);
  const processingRef = useRef(false);
  const pendingNewRoleRef = useRef(new Set<string>());
  const objectUrlsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const [selectionFence] = useState(createRevisionPhotoSelectionFence);
  const totalPhotoCount = (mainPhoto ? 1 : 0) + Object.keys(rolePhotos).length + extraPhotos.length;
  const extraInputDisabled = disabled || processing || totalPhotoCount >= 100;

  const release = useCallback((url: string) => {
    if (!objectUrlsRef.current.delete(url)) return;
    URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    selectionFence.mount();
    const objectUrls = objectUrlsRef.current;
    return () => {
      mountedRef.current = false;
      processingRef.current = false;
      selectionFence.unmount();
      for (const url of objectUrls) URL.revokeObjectURL(url);
      objectUrls.clear();
    };
  }, [selectionFence]);

  useEffect(() => {
    onChange([...(mainPhoto ? [mainPhoto] : []), ...Object.values(rolePhotos), ...extraPhotos]);
  }, [extraPhotos, mainPhoto, onChange, rolePhotos]);

  const toPhoto = useCallback(async (file: File, role: string): Promise<StudioPhoto> => {
    assertStudioSourceFile(file);
    const url = URL.createObjectURL(file);
    objectUrlsRef.current.add(url);
    try {
      const image = new window.Image();
      const dimensions = await withPromiseTimeout(new Promise<{ width: number; height: number }>((resolve, reject) => {
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
        image.src = url;
      }), 15_000, "모바일에서 이미지를 읽는 시간이 너무 오래 걸렸습니다. 사진을 다시 선택해 주세요.").finally(() => {
        image.onload = null;
        image.onerror = null;
      });
      assertStudioSourceDimensions(dimensions.width, dimensions.height);
      if (!mountedRef.current) throw new Error("상품 수정 화면이 닫혀 이미지 처리를 중단했습니다.");
      return { name: file.name, url, file, role, originalWidth: dimensions.width, originalHeight: dimensions.height };
    } catch (error) {
      release(url);
      throw error;
    }
  }, [release]);

  const selectMain = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || disabled) return;
    const token = selectionFence.nextMain();
    try {
      const next = await toPhoto(file, "main");
      if (releaseStaleRevisionPhoto(selectionFence.isCurrent(token), next.url, release)) return;
      setMainPhoto((current) => {
        if (current) release(current.url);
        return next;
      });
    } catch (error) {
      if (selectionFence.isCurrent(token)) onError(error instanceof Error ? error.message : "대표사진을 확인해 주세요.");
    }
  };

  const selectRole = async (role: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || disabled) return;
    if (!mainPhoto) {
      onError("역할별 사진보다 대표사진을 먼저 선택해 주세요.");
      return;
    }
    if (processingRef.current) {
      onError("추가 사진 확인이 끝난 뒤 역할별 사진을 선택해 주세요.");
      return;
    }
    const reservesNewSlot = !rolePhotos[role];
    if (reservesNewSlot
        && totalPhotoCount + pendingNewRoleRef.current.size >= 100) {
      onError("한 상품은 분석용 사진을 최대 100장까지 등록할 수 있습니다.");
      return;
    }
    if (reservesNewSlot) pendingNewRoleRef.current.add(role);
    const token = selectionFence.nextRole(role);
    try {
      const next = await toPhoto(file, role);
      if (releaseStaleRevisionPhoto(selectionFence.isCurrent(token), next.url, release)) return;
      setRolePhotos((current) => {
        if (current[role]) release(current[role].url);
        return { ...current, [role]: next };
      });
    } catch (error) {
      if (selectionFence.isCurrent(token)) onError(error instanceof Error ? error.message : "역할별 사진을 확인해 주세요.");
    } finally {
      if (reservesNewSlot) pendingNewRoleRef.current.delete(role);
    }
  };

  const selectExtras = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length || disabled || processingRef.current) return;
    if (!mainPhoto) {
      onError("추가 사진보다 대표사진을 먼저 선택해 주세요.");
      return;
    }
    if (pendingNewRoleRef.current.size) {
      onError("역할별 사진 확인이 끝난 뒤 추가 사진을 선택해 주세요.");
      return;
    }
    const remaining = Math.max(0, 100 - (mainPhoto ? 1 : 0) - Object.keys(rolePhotos).length - extraPhotos.length);
    if (!remaining) return onError("한 상품은 분석용 사진을 최대 100장까지 등록할 수 있습니다.");
    const token = selectionFence.nextExtras();
    processingRef.current = true;
    setProcessing(true);
    try {
      const selected = files.slice(0, remaining);
      const settled = await settleWithConcurrency(selected, 3, (file, index) => {
        if (!selectionFence.isCurrent(token)) throw new DOMException("이전 추가 사진 선택을 중단했습니다.", "AbortError");
        return toPhoto(file, `extra-${extraPhotos.length + index + 1}`);
      });
      const accepted = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (!selectionFence.isCurrent(token)) {
        for (const photo of accepted) release(photo.url);
        return;
      }
      if (accepted.length) setExtraPhotos((current) => {
        const capacity = Math.max(0, 100 - (mainPhoto ? 1 : 0) - Object.keys(rolePhotos).length);
        const next = [...current, ...accepted];
        const kept = next.slice(0, capacity);
        const keptUrls = new Set(kept.map((photo) => photo.url));
        for (const photo of accepted) if (!keptUrls.has(photo.url)) release(photo.url);
        return kept;
      });
      if (failure) onError(failure.reason instanceof Error ? failure.reason.message : "일부 추가 사진을 확인해 주세요.");
    } finally {
      if (selectionFence.isCurrent(token)) {
        processingRef.current = false;
        setProcessing(false);
      }
    }
  };

  const removeRole = (role: string) => {
    selectionFence.invalidateRole(role);
    setRolePhotos((current) => {
      const next = { ...current };
      if (next[role]) release(next[role].url);
      delete next[role];
      return next;
    });
  };
  const removeExtra = (index: number) => {
    selectionFence.invalidateExtras();
    processingRef.current = false;
    setProcessing(false);
    setExtraPhotos((current) => {
      if (current[index]) release(current[index].url);
      return current.filter((_, candidateIndex) => candidateIndex !== index);
    });
  };
  const clearMainAndDependents = () => {
    selectionFence.invalidateAll();
    processingRef.current = false;
    setProcessing(false);
    setMainPhoto((current) => {
      if (current) release(current.url);
      return null;
    });
    setRolePhotos((current) => {
      for (const photo of Object.values(current)) release(photo.url);
      return {};
    });
    setExtraPhotos((current) => {
      for (const photo of current) release(photo.url);
      return [];
    });
  };

  return <section className="product-revision-images" aria-labelledby="product-revision-images-title">
    <div className="intake-group-heading"><span>05</span><div><b id="product-revision-images-title">원본·대표·역할별 사진 교체</b><small>사진을 선택한 경우 같은 상품 ID로 AI 상세페이지를 다시 만들며 외부 채널에는 자동 게시하지 않습니다.</small></div></div>
    <div className="product-revision-main">
      <input id="product-revision-main-camera" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={disabled} onChange={(event) => void selectMain(event)} />
      <label htmlFor="product-revision-main" className={mainPhoto ? "has-photo" : ""} aria-disabled={disabled}>
        <input id="product-revision-main" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={(event) => void selectMain(event)} />
        {mainPhoto ? <><span><Image src={mainPhoto.url} alt="교체할 대표 상품 사진" fill sizes="(max-width: 720px) 88vw, 420px" unoptimized /></span><b>대표사진 교체됨</b><small>{mainPhoto.originalWidth}×{mainPhoto.originalHeight} 원본 보존 · 분석용 1200×1200 JPG</small></> : <><ImagePlus size={24} /><b>새 대표사진 선택</b><small>필수 · JPG, PNG, WEBP · 최소 600×600px</small></>}
      </label>
      <div className="product-revision-source-actions"><label htmlFor="product-revision-main-camera"><Camera size={15} />촬영</label><label htmlFor="product-revision-main"><ImagePlus size={15} />앨범</label>{mainPhoto ? <button type="button" disabled={disabled} onClick={clearMainAndDependents}><Trash2 size={14} />전체 제거</button> : null}</div>
    </div>
    <div className="product-revision-role-grid">
      {revisionPhotoRoles.map((role) => {
        const photo = rolePhotos[role.id];
        const roleDisabled = disabled || processing || (!photo && totalPhotoCount >= 100);
        return <div className={photo ? "has-photo" : ""} key={role.id}>
          <input id={`product-revision-${role.id}-camera`} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={roleDisabled} onChange={(event) => void selectRole(role.id, event)} />
          <label htmlFor={`product-revision-${role.id}`} aria-disabled={roleDisabled}>
            <input id={`product-revision-${role.id}`} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" disabled={roleDisabled} onChange={(event) => void selectRole(role.id, event)} />
            {photo ? <span><Image src={photo.url} alt={`교체할 ${role.label} 사진`} fill sizes="(max-width: 720px) 42vw, 120px" unoptimized /></span> : <ImagePlus size={17} />}
            <b>{role.label}</b><small>{photo ? "교체 · 다시 선택 가능" : "선택"}</small>
          </label>
          <div className="product-revision-source-actions two-way product-revision-role-source-actions" aria-label={`${role.label} 사진 입력 방식`}>
            <label className="product-revision-source-choice" htmlFor={`product-revision-${role.id}-camera`} aria-disabled={roleDisabled} aria-label={`${role.label} 사진 촬영`}><Camera size={14} />촬영</label>
            <label className="product-revision-source-choice" htmlFor={`product-revision-${role.id}`} aria-disabled={roleDisabled} aria-label={`${role.label} 사진 앨범에서 선택`}><ImagePlus size={14} />앨범</label>
          </div>
          {photo ? <button type="button" aria-label={`${role.label} 사진 제거`} disabled={disabled} onClick={() => removeRole(role.id)}><X size={12} /></button> : null}
        </div>;
      })}
    </div>
    <div className="product-revision-extras">
      <input id="product-revision-extras-camera" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={extraInputDisabled} onChange={(event) => void selectExtras(event)} />
      <label htmlFor="product-revision-extras" aria-disabled={extraInputDisabled}>
        <input id="product-revision-extras" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={extraInputDisabled} onChange={(event) => void selectExtras(event)} />
        {processing ? <LoaderCircle className="spin" size={17} /> : <ImagePlus size={17} />}<span><b>{processing ? "추가 사진 확인 중" : "추가 사진 여러 장"}</b><small>모바일 메모리 보호를 위해 3장씩 확인 · 전체 최대 100장</small></span>
      </label>
      <div className="product-revision-source-actions two-way product-revision-extra-source-actions" aria-label="추가 사진 입력 방식">
        <label className="product-revision-source-choice" htmlFor="product-revision-extras-camera" aria-disabled={extraInputDisabled} aria-label="추가 사진 촬영"><Camera size={14} />촬영</label>
        <label className="product-revision-source-choice" htmlFor="product-revision-extras" aria-disabled={extraInputDisabled} aria-label="추가 사진 앨범에서 선택"><ImagePlus size={14} />앨범</label>
      </div>
      {extraPhotos.length ? <div>{extraPhotos.map((photo, index) => <span key={`${photo.url}-${index}`}><Image src={photo.url} alt={`교체할 추가 상품 사진 ${index + 1}`} fill sizes="80px" unoptimized /><button type="button" aria-label={`추가 사진 ${index + 1} 제거`} disabled={disabled} onClick={() => removeExtra(index)}><X size={11} /></button></span>)}</div> : null}
    </div>
    <p className="product-revision-limitation"><b>채널 반영 제한</b> 새 사진과 AI 상세 결과는 중앙 상품에만 저장됩니다. 판매채널의 옵션·원격 SKU·이미지는 자동으로 추측하거나 변경하지 않으며, 채널 상품 수정에서 각 채널 지원 범위를 확인한 뒤 별도로 실행해야 합니다.</p>
  </section>;
}
