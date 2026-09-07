import { resolveProductSceneVariantCode } from "./ai-generated-assets";
import { formatSceneProfileBrief, type SceneProfileSelection } from "./product-scene-profiles";
import type { ProductSettingShot, ProductSettingShotPlan, SettingShotAssetId } from "./product-setting-shots";

const slots = [
  ["portrait","정면 패키지 중심","세로 근접 정면, 상품 실루엣이 우선","왼쪽 넓은 확산광","낮은 왼쪽 배경 접힘","상판과 후면을 얕게 분리"],
  ["wide","가로 브랜드 연출","가로 프레임의 비대칭 제품 배치","오른쪽 부드러운 측광","오른쪽 먼 후면의 넓은 색면","가로로 길게 열린 여백"],
  ["detail-overview","상품 첫인상","정면 전체 형태가 선명한 세로 구성","위쪽 큰 확산광","상부의 부드러운 밝기 전환","제품 뒤에 짧은 여백"],
  ["detail-use","사용 준비 맥락","상품 높이의 준비 공간 중경","낮은 오른쪽 사선광","합성 영역 밖 준비 상판 끝단","준비 평면과 먼 배경 분리"],
  ["detail-routine","일상 준비 맥락","왼쪽에서 보는 정리 공간 중경","왼쪽 창 방향의 중립광","정리 공간 외곽의 고정 분리면","접근 여백과 후면 분리"],
  ["detail-scale","형태·비율 확인","왜곡이 적은 정면 기준 프레임","정면 큰 면광원","하단 바깥의 단정한 기준 모서리","같은 초점면에서 전체 형태 확인"],
  ["detail-storage","보관 전 포장 확인","마개와 밀봉 외관을 확인하는 정면 구성","위 오른쪽 넓은 간접광","왼쪽 먼 후면의 완만한 톤 전환","포장 주변을 넓게 비운 건조 평면"],
  ["detail-context","브랜드 마무리","낮은 왜곡의 넓은 가로 구성","후면에서 들어오는 약한 확산광","상부 바깥의 넓은 후면 경계","넓은 전경과 짧은 후면 간격"],
] as const;

export function buildProfileSettingShotPlan(selection:SceneProfileSelection,identity:string):ProductSettingShotPlan {
  const profile=selection.profile;
  const variant=resolveProductSceneVariantCode(identity, "portrait", "moment", 3);
  return Object.fromEntries(slots.map(([id,purpose,camera,light,cue,depth])=>{
    const contextual=selection.confidence!=="fallback"&&(id==="detail-use"||id==="detail-routine");
    const prefix=`${profile.id}-${id}`;
    const setting:ProductSettingShot={
      label:purpose,
      location:contextual?`${profile.context}; ${purpose}. 상품 바로 주변만 보여주고 방 전체를 주제로 삼지 않는다`:`${profile.label} 제품 촬영용 평면 세트; ${purpose}. 실물 포장의 색과 형태가 중심이며 생활공간은 필수가 아니다`,
      moment:`${light}; 중립 색 재현을 유지하는 ${["넓은","부드러운","절제된"][variant]} 조명. ${purpose}의 윤곽과 라벨을 가리지 않는다`,
      surface:`${profile.surface}; ${purpose}용 건조한 연속 지지면. 색은 실제 패키지 팔레트에 맞추며 제품과 섞이지 않게 한다`,
      supportingObjects:`${cue}만 배경 구조로 허용한다. 판매 소품·원료·사용 결과·내용물·사람은 추가하지 않는다`,
      staging:`${depth}; ${purpose}. 해당 슬롯의 지정 합성 사각형과 원본 실루엣을 유지한다. 제품이 시각적 중심이고 배경은 보조다`,
      camera:`${camera}. 상품 자체는 원본 사진의 시점 그대로 합성하고 제공되지 않은 측면을 만들지 않는다`,
      separation:{location:`${prefix}-set`,moment:`${prefix}-light-${variant}`,surface:`${prefix}-plane`,supportingObjects:`${prefix}-cue`,staging:`${prefix}-depth`,camera:`${prefix}-camera`},
      sceneProfile:{id:profile.id,label:profile.label,mode:contextual?"contextual":"product-editorial",brief:formatSceneProfileBrief(selection),selectionReason:selection.reason,forbiddenContexts:profile.forbiddenContexts,evidenceFocus:profile.evidenceFocus},
    };
    return [id,setting];
  })) as ProductSettingShotPlan;
}

export function buildProfileSettingRetry(setting:ProductSettingShot,assetId:SettingShotAssetId,retry:number):ProductSettingShot {
  const transform=["배경 외곽 밝기 전환을 반대편으로 이동하고 확산광을 더 넓게 한다","후면과 지지면의 간격을 늘리고 배경 외곽 대비를 낮춘다","외곽 색면 크기를 줄이고 그림자를 부드럽게 한다"][retry-1];
  return {...setting,label:`${setting.label} · 재생성 ${retry}`,location:`${setting.location}; ${transform}`,moment:`${setting.moment}; ${transform}`,camera:`${setting.camera}; 제품 시점과 합성 좌표는 고정한다`,separation:Object.fromEntries(Object.entries(setting.separation).map(([key,value])=>[key,`${value}-r${retry}`])) as ProductSettingShot["separation"],staging:`${setting.staging}; ${assetId} 상품 사각형은 고정하고 실패한 배경 구도만 보정한다`};
}
