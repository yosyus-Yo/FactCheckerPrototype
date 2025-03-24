/**
 * AR 시각화 서비스 모듈
 * 팩트체킹 결과를 WebXR 기반 증강현실로 시각화하는 기능을 제공합니다.
 */
const logger = require('../utils/logger');
const { trustScoreToVisual } = require('../utils/helpers');
const config = require('../config');

/**
 * AR 시각화를 위한 씬 설정 생성
 * @returns {Object} - AR 씬 설정 객체
 */
function createARSceneConfig() {
  return {
    // AR 세션 요구 사항
    requiredFeatures: config.webxr.featuresRequired ? [
      'dom-overlay',
      'hit-test'
    ] : [],
    optionalFeatures: config.webxr.featuresOptional ? [
      'dom-overlay',
      'hit-test',
      'light-estimation'
    ] : [],
    
    // 탐지된 표면 정보 시각화 설정
    surfaceSettings: {
      showHitTest: true,
      surfaceColor: 0x03A9F4,
      surfaceOpacity: 0.3,
      hitTestRadius: 0.01,
      hitTestColor: 0x00FF00
    },
    
    // 신뢰도 점수에 따른 시각화 색상 설정
    trustScoreColors: {
      high: 0x4CAF50, // 녹색 (높음)
      medium: 0xFFC107, // 노란색 (중간)
      low: 0xF44336 // 빨간색 (낮음)
    }
  };
}

/**
 * WebXR 성능 최적화 설정
 * 디바이스 성능에 맞게 렌더링 품질을 조정합니다.
 * @param {string} performanceMode - 성능 모드 ('low', 'balanced', 'high')
 * @returns {Object} - 최적화 설정
 */
function createPerformanceConfig(performanceMode = config.webxr.performanceMode) {
  // 기본 성능 설정
  const baseConfig = {
    // 렌더링 품질 설정
    pixelRatio: 1.0,
    shadowMapEnabled: false,
    antialiasing: true,
    maxTextureSize: 2048,
    maxPolygons: 100000,
    
    // 성능 관련 설정
    useLevelOfDetail: true,
    useOcclusionCulling: true,
    useFrameThrottling: false,
    frameRate: 60,
    
    // 메모리 최적화 설정
    unloadUnusedAssets: true,
    textureCompression: true,
    instancedMeshes: true,
    
    // 지연 로딩 설정
    useLazyLoading: true,
    viewDistanceThreshold: 10
  };
  
  // 성능 모드별 설정 오버라이드
  switch (performanceMode) {
    case 'low':
      return {
        ...baseConfig,
        pixelRatio: 0.7,
        antialiasing: false,
        shadowMapEnabled: false,
        maxTextureSize: 1024,
        maxPolygons: 50000,
        frameRate: 30,
        viewDistanceThreshold: 5
      };
    case 'high':
      return {
        ...baseConfig,
        pixelRatio: 1.5,
        shadowMapEnabled: true,
        maxTextureSize: 4096,
        maxPolygons: 200000,
        useFrameThrottling: false,
        frameRate: 90,
        viewDistanceThreshold: 20
      };
    case 'balanced':
    default:
      return baseConfig;
  }
}

/**
 * 검증 결과에 따른 시각화 데이터 생성
 * @param {Object} verificationResult - 검증 결과 객체
 * @returns {Object} - 시각화 데이터 객체
 */
function generateVisualizationData(verificationResult) {
  if (!verificationResult) {
    return null;
  }
  
  // 결과 상태에 따른 색상 및 아이콘 매핑
  const statusConfig = {
    'VERIFIED_TRUE': {
      color: 0x4CAF50, // 녹색
      icon: 'check-circle',
      scale: 1.0
    },
    'VERIFIED_FALSE': {
      color: 0xF44336, // 빨간색
      icon: 'cancel',
      scale: 1.0
    },
    'PARTIALLY_TRUE': {
      color: 0xFFC107, // 노란색
      icon: 'help',
      scale: 0.9
    },
    'UNVERIFIED': {
      color: 0x9E9E9E, // 회색
      icon: 'help-outline',
      scale: 0.8
    }
  };
  
  // 신뢰도 점수에 따른 설정
  const trustScoreVisual = trustScoreToVisual(verificationResult.trustScore);
  const trustScoreConfig = {
    '매우 높음': { color: 0x1B5E20, opacity: 0.9, scale: 1.2 },
    '높음': { color: 0x4CAF50, opacity: 0.85, scale: 1.1 },
    '중간': { color: 0xFFC107, opacity: 0.8, scale: 1.0 },
    '낮음': { color: 0xFF5722, opacity: 0.75, scale: 0.9 },
    '매우 낮음': { color: 0xB71C1C, opacity: 0.7, scale: 0.8 }
  };
  
  // 상태 및 신뢰도에 대한 설정 가져오기
  const status = verificationResult.status || 'UNVERIFIED';
  const statusCfg = statusConfig[status] || statusConfig.UNVERIFIED;
  const trustCfg = trustScoreConfig[trustScoreVisual] || trustScoreConfig['중간'];
  
  // 시각화 데이터 생성
  return {
    status: status,
    trustScore: verificationResult.trustScore || 0.5,
    visualization: {
      color: statusCfg.color,
      icon: statusCfg.icon,
      scale: statusCfg.scale * trustCfg.scale,
      opacity: trustCfg.opacity,
      glowIntensity: verificationResult.trustScore || 0.5,
      pulseRate: status === 'UNVERIFIED' ? 1.5 : 0
    },
    metadata: {
      explanation: verificationResult.explanation || '검증 정보가 없습니다.',
      sources: verificationResult.sources || []
    }
  };
}

/**
 * WebXR 세션을 위한 메모리 최적화 함수
 * 사용하지 않는 리소스를 해제하고 메모리 사용량을 관리합니다.
 * @param {Object} scene - THREE.Scene 객체
 * @param {Object} renderer - THREE.WebGLRenderer 객체
 */
function optimizeMemoryUsage(scene, renderer) {
  // 불필요한 텍스처 및 지오메트리 해제
  const disposeObject = (obj) => {
    if (obj.geometry) {
      obj.geometry.dispose();
    }
    
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach(material => disposeMaterial(material));
      } else {
        disposeMaterial(obj.material);
      }
    }
    
    if (obj.children) {
      obj.children.forEach(child => disposeObject(child));
    }
  };
  
  const disposeMaterial = (material) => {
    if (material.map) material.map.dispose();
    if (material.lightMap) material.lightMap.dispose();
    if (material.bumpMap) material.bumpMap.dispose();
    if (material.normalMap) material.normalMap.dispose();
    if (material.specularMap) material.specularMap.dispose();
    if (material.envMap) material.envMap.dispose();
    if (material.alphaMap) material.alphaMap.dispose();
    if (material.aoMap) material.aoMap.dispose();
    if (material.displacementMap) material.displacementMap.dispose();
    if (material.emissiveMap) material.emissiveMap.dispose();
    if (material.gradientMap) material.gradientMap.dispose();
    if (material.metalnessMap) material.metalnessMap.dispose();
    if (material.roughnessMap) material.roughnessMap.dispose();
    material.dispose();
  };
  
  // 씬 내 사용하지 않는 객체 식별 및 제거
  const removeUnusedObjects = () => {
    // 간단한 예시: 특정 거리 밖의 객체 제거
    const viewDistanceThreshold = config.webxr.performanceMode === 'low' ? 5 : 
                                  config.webxr.performanceMode === 'high' ? 20 : 10;
    
    scene.children.forEach(obj => {
      if (obj.userData && obj.userData.isDisposable && 
          obj.position.distanceTo(scene.camera.position) > viewDistanceThreshold) {
        scene.remove(obj);
        disposeObject(obj);
      }
    });
  };
  
  // 렌더러 메모리 최적화
  const optimizeRenderer = () => {
    if (renderer) {
      // 사용하지 않는 프로그램과 텍스처 해제
      renderer.info.programs.forEach(program => {
        if (program && program.usedTimes === 0) {
          // 이 예시에서는 직접 프로그램을 해제할 수 없으므로 로깅만 수행
          logger.debug('Unused shader program detected');
        }
      });
      
      // 렌더 대상 최적화
      if (renderer.renderTarget) {
        renderer.renderTarget.dispose();
      }
    }
  };
  
  // 최적화 실행
  removeUnusedObjects();
  optimizeRenderer();
  
  // 가비지 컬렉션 힌트
  if (global.gc) {
    try {
      global.gc();
    } catch (e) {
      logger.debug('Manual garbage collection failed');
    }
  }
  
  logger.debug('Memory optimization completed', {
    rendererMemory: renderer ? JSON.stringify(renderer.info.memory) : 'N/A',
    rendererRender: renderer ? JSON.stringify(renderer.info.render) : 'N/A'
  });
}

/**
 * WebXR 렌더링 성능 최적화 함수
 * 프레임 속도와 렌더링 품질을 모니터링하고 조정합니다.
 * @param {Object} renderer - THREE.WebGLRenderer 객체
 * @param {Object} performanceConfig - 성능 설정 객체
 * @returns {Object} - 성능 모니터링 및 최적화 도구
 */
function createPerformanceMonitor(renderer, performanceConfig) {
  // 프레임 시간 측정을 위한 변수
  let lastFrameTime = 0;
  let frameCount = 0;
  let frameTimes = [];
  const MAX_FRAME_SAMPLES = 60;
  
  // 성능 지표
  const metrics = {
    fps: 0,
    averageFrameTime: 0,
    drawCalls: 0,
    triangles: 0,
    points: 0,
    lines: 0
  };
  
  // 현재 성능 설정
  let currentConfig = { ...performanceConfig };
  
  // 프레임 시간 업데이트
  const updateFrameTime = () => {
    const now = performance.now();
    
    if (lastFrameTime > 0) {
      const frameTime = now - lastFrameTime;
      
      // 프레임 시간 샘플 추가
      frameTimes.push(frameTime);
      if (frameTimes.length > MAX_FRAME_SAMPLES) {
        frameTimes.shift();
      }
      
      // 평균 프레임 시간 계산
      const totalTime = frameTimes.reduce((sum, time) => sum + time, 0);
      metrics.averageFrameTime = totalTime / frameTimes.length;
      metrics.fps = 1000 / metrics.averageFrameTime;
    }
    
    lastFrameTime = now;
    frameCount++;
  };
  
  // 렌더러 지표 업데이트
  const updateRendererMetrics = () => {
    if (renderer && renderer.info) {
      metrics.drawCalls = renderer.info.render.calls;
      metrics.triangles = renderer.info.render.triangles;
      metrics.points = renderer.info.render.points;
      metrics.lines = renderer.info.render.lines;
    }
  };
  
  // 성능 최적화
  const optimizePerformance = () => {
    // 현재 FPS가 목표보다 낮으면 품질 저하
    if (metrics.fps < currentConfig.frameRate * 0.8) {
      // 픽셀 비율 감소
      if (renderer && renderer.getPixelRatio() > 0.7) {
        renderer.setPixelRatio(Math.max(0.7, renderer.getPixelRatio() - 0.1));
        logger.debug(`Lowering pixel ratio to ${renderer.getPixelRatio()}`);
      }
      
      // 안티앨리어싱 비활성화
      if (currentConfig.antialiasing) {
        currentConfig.antialiasing = false;
        logger.debug('Disabling antialiasing');
        // 참고: 실제로는 렌더러를 다시 생성해야 할 수 있음
      }
      
      // 시야 거리 감소
      if (currentConfig.viewDistanceThreshold > 5) {
        currentConfig.viewDistanceThreshold -= 2;
        logger.debug(`Reducing view distance to ${currentConfig.viewDistanceThreshold}`);
      }
    }
    // 현재 FPS가 충분히 높으면 품질 향상 고려
    else if (metrics.fps > currentConfig.frameRate * 1.2) {
      // 필요한 경우 품질 향상 로직 추가
    }
  };
  
  // 현재 성능 상태 가져오기
  const getMetrics = () => ({ ...metrics });
  
  // 현재 성능 설정 가져오기
  const getConfig = () => ({ ...currentConfig });
  
  // 성능 설정 업데이트
  const updateConfig = (newConfig) => {
    currentConfig = { ...currentConfig, ...newConfig };
    return currentConfig;
  };
  
  // 공개 API 반환
  return {
    update: () => {
      updateFrameTime();
      updateRendererMetrics();
      // 10초마다 자동 최적화 수행 (프레임 카운트로 주기 제어)
      if (frameCount % 600 === 0) {
        optimizePerformance();
      }
    },
    getMetrics,
    getConfig,
    updateConfig,
    optimizeNow: optimizePerformance
  };
}

/**
 * WebXR 애셋 설정 생성
 * @returns {Object} - WebXR 애셋 설정
 */
function createWebXRAssets() {
  return {
    models: {
      check: '/assets/models/check.glb',
      cross: '/assets/models/cross.glb',
      question: '/assets/models/question.glb',
      info: '/assets/models/info.glb',
      sourceNode: '/assets/models/source_node.glb'
    },
    textures: {
      factTrue: '/assets/textures/fact_true.png',
      factFalse: '/assets/textures/fact_false.png',
      factPartial: '/assets/textures/fact_partial.png',
      factUnknown: '/assets/textures/fact_unknown.png'
    },
    fonts: {
      main: '/assets/fonts/NotoSansKR-Regular.json'
    }
  };
}

/**
 * AR UI 모드 설정
 * @returns {Object} - AR UI 모드 설정
 */
function getARUIModes() {
  return {
    PLACING: 'placing', // 시각화 배치 모드
    VIEWING: 'viewing',  // 시각화 조회 모드
    DETAILS: 'details',  // 상세 정보 조회 모드
    SOURCES: 'sources'   // 소스 조회 모드
  };
}

/**
 * 소스 위치 계산 (원형 배치)
 * @param {number} index - 소스 인덱스
 * @param {number} total - 전체 소스 개수
 * @returns {Object} - 3D 위치 좌표
 */
function calculateSourcePosition(index, total) {
  const radius = 0.5; // 원의 반지름
  const angle = (index / total) * Math.PI * 2;
  
  return {
    x: radius * Math.cos(angle),
    y: 0.1,
    z: radius * Math.sin(angle)
  };
}

/**
 * 상태 코드를 텍스트로 변환
 * @param {string} status - 상태 코드
 * @returns {string} - 상태 텍스트
 */
function mapStatusToText(status) {
  const statusMap = {
    'VERIFIED_TRUE': '사실',
    'VERIFIED_FALSE': '거짓',
    'PARTIALLY_TRUE': '부분 사실',
    'UNVERIFIED': '미확인',
    'DISPUTED': '논쟁 중'
  };
  
  return statusMap[status] || '미확인';
}

/**
 * 신뢰도 점수를 색상으로 변환
 * @param {number} credibility - 신뢰도 점수 (0-1)
 * @returns {number} - RGB 색상 값
 */
function mapCredibilityToColor(credibility) {
  // 빨강(낮음)에서 녹색(높음)으로 그라데이션
  if (credibility >= 0.7) {
    // 높은 신뢰도 - 녹색 계열
    return 0x4CAF50;
  } else if (credibility >= 0.4) {
    // 중간 신뢰도 - 노란색 계열
    return 0xFFC107;
  } else {
    // 낮은 신뢰도 - 빨간색 계열
    return 0xF44336;
  }
}

/**
 * WebXR 세션 상태 초기화
 * @returns {Object} - WebXR 세션 상태
 */
function initializeWebXRSessionState() {
  return {
    isSupported: false,
    isSessionStarted: false,
    currentMode: 'placing',
    hitTestSource: null,
    viewerSpace: null,
    hitTestResults: [],
    placedObjects: [],
    currentVerificationResult: null
  };
}

/**
 * 팩트체크 결과 이벤트 전송
 * @param {Object} result - 검증 결과 데이터
 */
function sendVerificationResult(result) {
  const clients = global.sseClients || [];
  const message = {
    type: 'verification_complete',
    summary: {
      trustScore: result.trustScore,
      verdict: result.verdict,
      mainPoints: result.mainPoints || [],
      sources: result.sources || []
    },
    visualStyle: {
      color: getTrustScoreColor(result.trustScore),
      icon: getTrustScoreIcon(result.trustScore)
    }
  };

  clients.forEach(client => {
    client.send(JSON.stringify(message));
  });
}

/**
 * 팩트체크 진행 상태 이벤트 전송
 * @param {number} progress - 진행률 (0-100)
 * @param {string} status - 상태 메시지
 */
function sendVerificationProgress(progress, status) {
  const clients = global.sseClients || [];
  const message = {
    type: 'verification_progress',
    progress,
    status
  };

  clients.forEach(client => {
    client.send(JSON.stringify(message));
  });
}

/**
 * 팩트체크 오류 이벤트 전송
 * @param {string} error - 오류 메시지
 */
function sendVerificationError(error) {
  const clients = global.sseClients || [];
  const message = {
    type: 'verification_error',
    error
  };

  clients.forEach(client => {
    client.send(JSON.stringify(message));
  });
}

/**
 * 신뢰도 점수에 따른 색상 반환
 * @param {number} score - 신뢰도 점수 (0-100)
 * @returns {string} 색상 코드
 */
function getTrustScoreColor(score) {
  if (score >= 80) return '#4CAF50';  // 높은 신뢰도
  if (score >= 60) return '#FFC107';  // 중간 신뢰도
  if (score >= 40) return '#FF9800';  // 낮은 신뢰도
  return '#F44336';  // 매우 낮은 신뢰도
}

/**
 * 신뢰도 점수에 따른 아이콘 반환
 * @param {number} score - 신뢰도 점수 (0-100)
 * @returns {string} Material Icons 이름
 */
function getTrustScoreIcon(score) {
  if (score >= 80) return 'verified';
  if (score >= 60) return 'thumb_up';
  if (score >= 40) return 'warning';
  return 'error';
}

module.exports = {
  createARSceneConfig,
  createPerformanceConfig,
  generateVisualizationData,
  optimizeMemoryUsage,
  createPerformanceMonitor,
  createWebXRAssets,
  getARUIModes,
  initializeWebXRSessionState,
  sendVerificationResult,
  sendVerificationProgress,
  sendVerificationError
}; 