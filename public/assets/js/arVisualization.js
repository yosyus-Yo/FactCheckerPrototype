/**
 * FactChecker AR 시각화 기능
 * WebXR API와 Three.js를 사용한 AR 시각화 기능을 제공합니다.
 */

// 전역 변수
let arConfig = null;
let arAssets = null;
let arScene = null;
let arCamera = null;
let arRenderer = null;
let arControls = null;
let arReticle = null;
let currentHitTestResults = null;
let placedObjects = [];
let isArSupported = false;
let isArSessionStarted = false;

// AR 컨테이너 요소
const arSceneContainer = document.getElementById('ar-scene-container');
const startArButton = document.getElementById('start-ar');

/**
 * AR 시각화 초기화
 * @param {Object} verificationResult - 검증 결과 객체
 */
async function initARVisualization(verificationResult) {
  console.log('AR 시각화 초기화:', verificationResult);
  
  // AR 설정 및 애셋 가져오기
  try {
    const response = await fetch('/api/ar/config');
    if (!response.ok) {
      throw new Error('AR 설정을 가져올 수 없습니다.');
    }
    
    const data = await response.json();
    arConfig = data.config;
    arAssets = data.assets;
    
    console.log('AR 설정 로드됨:', arConfig);
  } catch (error) {
    console.error('AR 설정 로드 실패:', error);
    alert('AR 설정을 가져오는 중 오류가 발생했습니다.');
    return;
  }
  
  // WebXR 지원 여부 확인
  if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-ar')
      .then((supported) => {
        isArSupported = supported;
        
        if (supported) {
          // AR 시각화 데이터 가져오기
          fetchVisualizationData(verificationResult)
            .then((visualizationData) => {
              // Three.js 씬 초기화
              initThreeScene(visualizationData);
              // WebXR 세션 시작 버튼 활성화
              setupArButton(visualizationData);
            })
            .catch(error => {
              console.error('시각화 데이터 가져오기 실패:', error);
              alert('AR 시각화 데이터를 생성할 수 없습니다.');
            });
        } else {
          alert('이 기기는 WebXR AR을 지원하지 않습니다.');
        }
      });
  } else {
    alert('이 브라우저는 WebXR을 지원하지 않습니다. Chrome 또는 Samsung Internet 브라우저를 사용해주세요.');
  }
}

/**
 * 시각화 데이터 가져오기
 * @param {Object} verificationResult - 검증 결과 객체
 * @returns {Promise<Object>} - 시각화 데이터
 */
async function fetchVisualizationData(verificationResult) {
  try {
    const response = await fetch('/api/ar/visualize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ verificationResult })
    });
    
    if (!response.ok) {
      throw new Error('시각화 데이터를 가져올 수 없습니다.');
    }
    
    const data = await response.json();
    return data.visualizationData;
  } catch (error) {
    console.error('시각화 데이터 요청 실패:', error);
    throw error;
  }
}

/**
 * Three.js 씬 초기화
 * @param {Object} visualizationData - 시각화 데이터
 */
function initThreeScene(visualizationData) {
  // 씬 생성
  arScene = new THREE.Scene();
  
  // 카메라 생성
  arCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 20);
  
  // 렌더러 생성
  arRenderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true
  });
  arRenderer.setSize(window.innerWidth, window.innerHeight);
  arRenderer.setPixelRatio(window.devicePixelRatio);
  arRenderer.xr.enabled = true;
  
  // 컨테이너에 캔버스 추가
  arSceneContainer.innerHTML = '';
  arSceneContainer.appendChild(arRenderer.domElement);
  
  // 조명 추가
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  arScene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(0, 5, 0);
  arScene.add(directionalLight);
  
  // 레티클(타겟 포인터) 생성
  createReticle();
  
  // 윈도우 리사이즈 이벤트 처리
  window.addEventListener('resize', onResize);
}

/**
 * 레티클(타겟 포인터) 생성
 */
function createReticle() {
  const geometry = new THREE.RingGeometry(0.03, 0.04, 32);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    opacity: 0.5,
    transparent: true,
    side: THREE.DoubleSide
  });
  
  arReticle = new THREE.Mesh(geometry, material);
  arReticle.rotation.x = -Math.PI / 2;
  arReticle.matrixAutoUpdate = false;
  arReticle.visible = false;
  arScene.add(arReticle);
}

/**
 * AR 세션 시작 버튼 설정
 * @param {Object} visualizationData - 시각화 데이터
 */
function setupArButton(visualizationData) {
  startArButton.disabled = false;
  startArButton.textContent = 'AR로 결과 보기';
  
  startArButton.addEventListener('click', () => {
    if (!isArSessionStarted) {
      startArSession(visualizationData);
    } else {
      stopArSession();
    }
  });
}

/**
 * AR 세션 시작
 * @param {Object} visualizationData - 시각화 데이터
 */
function startArSession(visualizationData) {
  if (!isArSupported) {
    alert('이 기기는 WebXR AR을 지원하지 않습니다.');
    return;
  }
  
  const sessionInit = {
    requiredFeatures: arConfig.requiredFeatures,
    optionalFeatures: arConfig.optionalFeatures
  };
  
  navigator.xr.requestSession('immersive-ar', sessionInit)
    .then((session) => {
      isArSessionStarted = true;
      startArButton.textContent = 'AR 종료';
      arSceneContainer.classList.add('active');
      
      // XR 세션 설정
      arRenderer.xr.setSession(session);
      arRenderer.xr.setReferenceSpaceType('local');
      
      // 히트 테스트 소스 설정
      setupHitTest(session);
      
      // 렌더 루프 시작
      arRenderer.setAnimationLoop((timestamp, frame) => {
        arRenderLoop(timestamp, frame, visualizationData);
      });
      
      // 세션 종료 이벤트 리스너
      session.addEventListener('end', () => {
        isArSessionStarted = false;
        startArButton.textContent = 'AR로 결과 보기';
        arSceneContainer.classList.remove('active');
        arRenderer.setAnimationLoop(null);
      });
    })
    .catch(error => {
      console.error('AR 세션 시작 실패:', error);
      alert('AR 세션을 시작할 수 없습니다.');
    });
}

/**
 * 히트 테스트 설정
 * @param {XRSession} session - WebXR 세션
 */
function setupHitTest(session) {
  session.requestReferenceSpace('viewer')
    .then((viewerSpace) => {
      session.requestHitTestSource({ space: viewerSpace })
        .then((source) => {
          hitTestSource = source;
        });
    });
}

/**
 * AR 렌더 루프
 * @param {DOMHighResTimeStamp} timestamp - 타임스탬프
 * @param {XRFrame} frame - XR 프레임
 * @param {Object} visualizationData - 시각화 데이터
 */
function arRenderLoop(timestamp, frame, visualizationData) {
  if (!frame) return;
  
  const referenceSpace = arRenderer.xr.getReferenceSpace();
  const session = arRenderer.xr.getSession();
  
  // 히트 테스트 업데이트
  if (hitTestSource && frame) {
    const hitTestResults = frame.getHitTestResults(hitTestSource);
    
    if (hitTestResults.length) {
      const hit = hitTestResults[0];
      const pose = hit.getPose(referenceSpace);
      
      arReticle.visible = true;
      arReticle.matrix.fromArray(pose.transform.matrix);
      currentHitTestResults = hitTestResults;
    } else {
      arReticle.visible = false;
      currentHitTestResults = null;
    }
  }
  
  // 터치 이벤트 처리
  processInput(frame, session, visualizationData);
  
  // 씬 렌더링
  arRenderer.render(arScene, arCamera);
}

/**
 * 입력 처리
 * @param {XRFrame} frame - XR 프레임
 * @param {XRSession} session - XR 세션
 * @param {Object} visualizationData - 시각화 데이터
 */
function processInput(frame, session, visualizationData) {
  if (!session) return;
  
  // 세션 입력 소스 가져오기
  const inputSources = Array.from(session.inputSources);
  
  // 각 입력 소스에 대해 처리
  for (const inputSource of inputSources) {
    if (inputSource.targetRayMode === 'screen') {
      const referenceSpace = arRenderer.xr.getReferenceSpace();
      const pose = frame.getPose(inputSource.targetRaySpace, referenceSpace);
      
      if (pose && currentHitTestResults && currentHitTestResults.length > 0) {
        // 터치 이벤트 발생 시 결과 배치
        const hit = currentHitTestResults[0];
        const hitPose = hit.getPose(referenceSpace);
        
        if (hitPose && placedObjects.length === 0) {
          placeVerificationResult(hitPose, visualizationData);
        }
      }
    }
  }
}

/**
 * 검증 결과 시각화 배치
 * @param {XRPose} hitPose - 히트 포즈
 * @param {Object} visualizationData - 시각화 데이터
 */
function placeVerificationResult(hitPose, visualizationData) {
  // 상태에 따른 색상 설정
  const display = visualizationData.mainDisplay;
  const color = new THREE.Color(display.color);
  
  // 메인 객체 생성 (상태 표시)
  const mainGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.01, 32);
  const mainMaterial = new THREE.MeshPhongMaterial({
    color: color,
    opacity: display.opacity,
    transparent: true
  });
  
  const mainObject = new THREE.Mesh(mainGeometry, mainMaterial);
  
  // 위치 지정
  mainObject.position.setFromMatrixPosition(hitPose.transform.matrix);
  mainObject.position.y += 0.01; // 약간 위로 올림
  
  // 씬에 추가
  arScene.add(mainObject);
  placedObjects.push(mainObject);
  
  // 상태 텍스트 생성
  createTextLabel(display.statusText, {
    position: new THREE.Vector3(
      mainObject.position.x,
      mainObject.position.y + 0.05,
      mainObject.position.z
    ),
    color: 0xffffff,
    size: 0.05,
    opacity: 0.9
  });
  
  // 소스 위치 계산 (메인 객체 주변)
  const sources = visualizationData.sources || [];
  sources.forEach((source, index) => {
    const angle = (index / sources.length) * Math.PI * 2;
    const radius = 0.2;
    
    const x = mainObject.position.x + radius * Math.cos(angle);
    const y = mainObject.position.y + 0.02;
    const z = mainObject.position.z + radius * Math.sin(angle);
    
    // 소스 표시 객체 생성
    const sourceGeometry = new THREE.SphereGeometry(0.02, 16, 16);
    const sourceMaterial = new THREE.MeshPhongMaterial({
      color: source.color || 0x3498db,
      opacity: 0.8,
      transparent: true
    });
    
    const sourceObject = new THREE.Mesh(sourceGeometry, sourceMaterial);
    sourceObject.position.set(x, y, z);
    
    arScene.add(sourceObject);
    placedObjects.push(sourceObject);
    
    // 소스 이름 텍스트 추가
    createTextLabel(source.name, {
      position: new THREE.Vector3(x, y + 0.03, z),
      color: 0xffffff,
      size: 0.02,
      opacity: 0.8
    });
  });
}

/**
 * 텍스트 라벨 생성
 * @param {string} text - 표시할 텍스트
 * @param {Object} options - 텍스트 옵션
 */
function createTextLabel(text, options) {
  // 임시 캔버스 생성
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  
  // 캔버스 크기 설정
  canvas.width = 256;
  canvas.height = 128;
  
  // 배경색 설정 (투명)
  context.fillStyle = 'rgba(0, 0, 0, 0)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  
  // 텍스트 스타일 설정
  context.font = '36px Arial';
  context.fillStyle = 'white';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  
  // 텍스트 그리기
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  
  // 텍스처 생성
  const texture = new THREE.CanvasTexture(canvas);
  
  // 재질 생성
  const material = new THREE.SpriteMaterial({
    map: texture,
    opacity: options.opacity || 1.0,
    transparent: true
  });
  
  // 스프라이트 생성
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(options.position);
  sprite.scale.set(options.size * 5, options.size * 2.5, 1);
  
  // 씬에 추가
  arScene.add(sprite);
  placedObjects.push(sprite);
  
  return sprite;
}

/**
 * AR 세션 종료
 */
function stopArSession() {
  if (isArSessionStarted && arRenderer.xr.getSession()) {
    arRenderer.xr.getSession().end();
  }
}

/**
 * 윈도우 리사이즈 이벤트 핸들러
 */
function onResize() {
  if (arCamera && arRenderer) {
    arCamera.aspect = window.innerWidth / window.innerHeight;
    arCamera.updateProjectionMatrix();
    arRenderer.setSize(window.innerWidth, window.innerHeight);
  }
} 