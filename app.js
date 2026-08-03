/*
 * 南極スライダー本体。
 *
 * もともと index.html の中に直接書かれていた。CSP を script-src 'self' で
 * 締めると、インラインの <script> は実行されない（ハッシュか 'unsafe-inline' が要る）。
 * 'unsafe-inline' を足すと CSP を入れた意味がほとんど無くなるので、
 * こちらへ切り出した。中身は動かしていない。
 *
 * ボタンの onclick= も同じ理由で使えないため、末尾で addEventListener に繋いでいる。
 */
    /**
     * 👑 GIGA Game Architect - Game Logic (Swipe & Rich Animation Version)
     * テーマ：ツルツル！氷上の大運動会 🐧🆚🦭
     */

    const BOARD_SIZE = 5;
    const GOAL_POS = { row: 2, col: 2 };
    const CELL_PERCENT = 100 / BOARD_SIZE;
    const SWIPE_THRESHOLD = 24; // px

    const PIECE = {
      EMPTY: 0,
      P1_SUB: 11, P1_MAIN: 12,
      P2_SUB: 21, P2_MAIN: 22,
      GOAL: 99
    };

    let gameState = {
      board: [],
      currentPlayer: 1,
      winner: null,
      isAnimating: false
    };

    let selectedPiece = null;
    let pointerStart = null; // スワイプ開始座標 { x, y, onPiece }
    let gameGeneration = 0;  // リセット世代。アニメーション中のリセットで古い処理を無効化する

    document.addEventListener('DOMContentLoaded', () => {
      initGame();
      setupControls();
    });

    // PWA: Service Worker 登録
    // 「ホーム画面に入れる」。案内できるときだけボタンを出す。
    // 出せないボタンを置いておくと「押しても何も起きない」と言われる。
    (function () {
      const btn = document.getElementById('install-btn');
      if (!btn) return;
      const sync = () => { btn.hidden = !window.__pwaInstallPrompt; };
      sync();
      window.addEventListener('pwa-install-available', sync);
      window.addEventListener('pwa-installed', sync);
      btn.addEventListener('click', async () => {
        const deferred = window.__pwaInstallPrompt;
        if (!deferred) return;
        window.__pwaInstallPrompt = null;
        sync();
        deferred.prompt();
        await deferred.userChoice.catch(() => null);
      });
    })();

    if ('serviceWorker' in navigator) {
      // 「さいしんに する」を押したときだけ、切り替え完了を待って読み込み直す。
      //
      // controllerchange は、はじめて開いたときにも飛んでくる。
      // Service Worker が activate で clients.claim() を呼ぶと、それまで
      // 管理下になかったページが管理下に入り、この合図が出るため。
      // これを素直に受けると **初回訪問が必ず1回リロードされ**、
      // 並べたばかりの盤面がその場でリセットされる（実測で確認した）。
      //
      // 「管理下だったかどうか」で分けるのも間違い。初回に入れた直後で
      // 更新を押した場合に、今度は読み込み直されなくなる（これも実測で踏んだ）。
      // 見るべきは **利用者が押したかどうか** だけ。
      let userAskedUpdate = false;
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!userAskedUpdate || reloading) return;
        reloading = true;
        window.location.reload();
      });

      const startSW = () => {
        navigator.serviceWorker.register('./sw.js').then((registration) => {
          const notify = (worker) => {
            if (!worker) return;
            const bar = document.getElementById('update-bar');
            if (!bar) return;
            bar.hidden = false;
            bar.querySelector('button').onclick = () => {
              userAskedUpdate = true;
              worker.postMessage({ type: 'SKIP_WAITING' });
            };
          };
          // controller が居るときだけ知らせる。初回インストールで
          // 「入れた直後に更新があります」と出ると混乱する。
          if (registration.waiting && navigator.serviceWorker.controller) notify(registration.waiting);
          registration.addEventListener('updatefound', () => {
            const installing = registration.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) notify(installing);
            });
          });
        }).catch((err) => {
          console.warn('Service Worker registration failed:', err);
        });
      };

      // load を待つが、もう終わっているなら待っても二度と来ないのでその場で走らせる。
      if (document.readyState === 'complete') startSW();
      else window.addEventListener('load', startSW, { once: true });
    }

    function isGoalCell(row, col) {
      return row === GOAL_POS.row && col === GOAL_POS.col;
    }

    // 通常の初期配置（定位置）
    function initGame() {
      gameState.board = [
        [11, 11, 12, 11, 11],
        [0,  0,  0,  0,  0],
        [0,  0, 99,  0,  0],
        [0,  0,  0,  0,  0],
        [21, 21, 22, 21, 21]
      ];

      resetGameState();
    }

    /**
     * ランダム配置でゲームを開始する関数
     */
    function initRandomGame() {
      // 1. 盤面を空で初期化
      const board = Array(BOARD_SIZE).fill(0).map(() => Array(BOARD_SIZE).fill(PIECE.EMPTY));

      // 2. ゴール設置
      board[GOAL_POS.row][GOAL_POS.col] = PIECE.GOAL;

      // 3. 配置可能な座標リストを作成（ゴール以外）
      // ゴール地点を除外することで、王冠がいきなりゴールに置かれるのを防ぎます
      const availablePositions = [];
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (isGoalCell(r, c)) continue;
          availablePositions.push({ r, c });
        }
      }

      // 4. 座標をシャッフル (Fisher-Yates shuffle)
      for (let i = availablePositions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [availablePositions[i], availablePositions[j]] = [availablePositions[j], availablePositions[i]];
      }

      // 5. 配置する駒のリスト (P1:5個, P2:5個)
      const pieces = [
        PIECE.P1_MAIN, PIECE.P1_SUB, PIECE.P1_SUB, PIECE.P1_SUB, PIECE.P1_SUB,
        PIECE.P2_MAIN, PIECE.P2_SUB, PIECE.P2_SUB, PIECE.P2_SUB, PIECE.P2_SUB
      ];

      // 6. 駒を配置
      for (let i = 0; i < pieces.length; i++) {
        const pos = availablePositions[i];
        board[pos.r][pos.c] = pieces[i];
      }

      gameState.board = board;
      resetGameState();

      if (typeof Swal === 'undefined') return;

      // 通知トースト
      const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: false,
      });
      Toast.fire({
        icon: 'info',
        title: 'サイコロをふってバラバラになりました！🎲'
      });
    }

    // 共通のリセット処理
    function resetGameState() {
      gameGeneration++; // 進行中のアニメーション処理を無効化
      gameState.currentPlayer = 1;
      gameState.winner = null;
      gameState.isAnimating = false;
      selectedPiece = null;

      renderBoard();
      updateTurnDisplay();
    }

    function renderBoard() {
      const boardEl = document.getElementById('game-board');
      boardEl.innerHTML = '';

      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const cell = document.createElement('div');
          cell.className = 'cell';
          if (isGoalCell(r, c)) {
            cell.classList.add('goal');
            if (gameState.board[r][c] !== PIECE.GOAL && gameState.board[r][c] !== PIECE.EMPTY) {
              cell.classList.add('active');
            }
          }
          boardEl.appendChild(cell);
        }
      }

      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const type = gameState.board[r][c];
          if (type !== PIECE.EMPTY && type !== PIECE.GOAL) {
            createPieceElement(r, c, type);
          }
        }
      }
    }

    function createPieceElement(row, col, type) {
      const boardEl = document.getElementById('game-board');
      const piece = document.createElement('div');

      piece.className = 'piece';
      if (type === PIECE.P1_SUB || type === PIECE.P1_MAIN) piece.classList.add('p1');
      if (type === PIECE.P2_SUB || type === PIECE.P2_MAIN) piece.classList.add('p2');
      if (type === PIECE.P1_MAIN || type === PIECE.P2_MAIN) piece.classList.add('king');

      setPosition(piece, row, col);

      const isMyPiece = (gameState.currentPlayer === 1 && type < 20) ||
                        (gameState.currentPlayer === 2 && type > 20);

      if (isMyPiece && !gameState.winner) {
        piece.addEventListener('pointerdown', () => {
          selectPiece(row, col, piece);
        });
      }

      piece.id = `piece-${row}-${col}`;
      boardEl.appendChild(piece);
    }

    function setPosition(element, row, col) {
      element.style.top = (row * CELL_PERCENT + CELL_PERCENT / 2) + '%';
      element.style.left = (col * CELL_PERCENT + CELL_PERCENT / 2) + '%';
      if (!element.classList.contains('move-up') &&
          !element.classList.contains('move-down') &&
          !element.classList.contains('move-left') &&
          !element.classList.contains('move-right')) {
          element.style.transform = 'translate(-50%, -50%)';
      }
    }

    function updateTurnDisplay() {
      const indicator = document.getElementById('turn-indicator');

      if (gameState.currentPlayer === 1) {
        indicator.textContent = '🐧 ペンギンのばん';
        indicator.className = 'turn-p1';
      } else {
        indicator.textContent = '🦭 アザラシのばん';
        indicator.className = 'turn-p2';
      }
    }

    function selectPiece(row, col, element) {
      if (gameState.isAnimating || gameState.winner) return;

      document.querySelectorAll('.piece.selected').forEach(el => el.classList.remove('selected'));
      selectedPiece = { row, col };
      element.classList.add('selected');
    }

    function clearSelection() {
      document.querySelectorAll('.piece.selected').forEach(el => el.classList.remove('selected'));
      selectedPiece = null;
    }

    function setupControls() {
      // キーボード操作 (矢印キー / WASD)
      document.addEventListener('keydown', (e) => {
        const keyMap = {
          'ArrowUp': 'up', 'ArrowDown': 'down',
          'ArrowLeft': 'left', 'ArrowRight': 'right',
          'w': 'up', 's': 'down', 'a': 'left', 'd': 'right'
        };
        if (keyMap[e.key]) {
          e.preventDefault(); // 矢印キーによる画面スクロールを防ぐ
          tryMove(keyMap[e.key]);
        }
      });

      // スワイプ操作 (Pointer Events でタッチ・マウス両対応)
      document.addEventListener('pointerdown', (e) => {
        pointerStart = {
          x: e.clientX,
          y: e.clientY,
          onPiece: !!(e.target.closest && e.target.closest('.piece'))
        };
      });

      document.addEventListener('pointerup', (e) => {
        if (!pointerStart) return;
        const start = pointerStart;
        pointerStart = null;

        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;

        // 動きが小さい場合はタップ扱い: コマ以外の場所なら選択解除
        if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) {
          const onPieceNow = !!(e.target.closest && e.target.closest('.piece'));
          if (!start.onPiece && !onPieceNow) clearSelection();
          return;
        }

        if (!selectedPiece || gameState.isAnimating) return;

        if (Math.abs(dx) > Math.abs(dy)) {
          tryMove(dx > 0 ? 'right' : 'left');
        } else {
          tryMove(dy > 0 ? 'down' : 'up');
        }
      });

      document.addEventListener('pointercancel', () => {
        pointerStart = null;
      });
    }

    function tryMove(direction) {
      if (!selectedPiece || gameState.isAnimating || gameState.winner) return;

      const { row, col } = selectedPiece;
      const pieceType = gameState.board[row][col];
      const pieceEl = document.getElementById(`piece-${row}-${col}`);
      if (!pieceEl) return;

      const target = calculateSlideTarget(row, col, direction);

      if (target.row === row && target.col === col) return;

      const generation = gameGeneration;
      gameState.isAnimating = true;
      gameState.board[row][col] = isGoalCell(row, col) ? PIECE.GOAL : PIECE.EMPTY;

      const moveClass = `move-${direction}`;
      pieceEl.classList.add(moveClass);
      pieceEl.classList.remove('selected');

      pieceEl.id = `piece-${target.row}-${target.col}`;
      setPosition(pieceEl, target.row, target.col);

      setTimeout(() => {
        if (generation !== gameGeneration) return; // アニメーション中にリセットされた
        pieceEl.classList.remove(moveClass);
        pieceEl.classList.add('impact');

        setTimeout(() => {
          if (generation !== gameGeneration) return;
          pieceEl.classList.remove('impact');

          gameState.board[target.row][target.col] = pieceType;
          selectedPiece = null;
          gameState.isAnimating = false;

          checkWin(pieceType, target.row, target.col);

          if (!gameState.winner) {
            gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
            updateTurnDisplay();
            renderBoard();
          }
        }, 300);

      }, 400);
    }

    function calculateSlideTarget(startRow, startCol, direction) {
      let r = startRow;
      let c = startCol;
      const vectors = { 'up': [-1, 0], 'down': [1, 0], 'left': [0, -1], 'right': [0, 1] };
      const [dr, dc] = vectors[direction];

      while (true) {
        const nextR = r + dr;
        const nextC = c + dc;
        if (nextR < 0 || nextR >= BOARD_SIZE || nextC < 0 || nextC >= BOARD_SIZE) break;
        const cellType = gameState.board[nextR][nextC];
        if (cellType !== PIECE.EMPTY && cellType !== PIECE.GOAL) break;
        r = nextR;
        c = nextC;
      }
      return { row: r, col: c };
    }

    function checkWin(pieceType, row, col) {
      const isKing = (pieceType === PIECE.P1_MAIN || pieceType === PIECE.P2_MAIN);
      if (isKing && isGoalCell(row, col)) {
        gameState.winner = (pieceType === PIECE.P1_MAIN) ? 1 : 2;
        showWinModal();
      }
    }

    function showWinModal() {
      const winnerName = gameState.winner === 1 ? "ペンギンチーム 🐧" : "アザラシチーム 🦭";
      const color = gameState.winner === 1 ? '#00C2CB' : '#FF8BA7';

      if (typeof Swal === 'undefined') {
        alert(`🎉 おめでとう！ ${winnerName}のかち！`);
        initGame();
        return;
      }

      Swal.fire({
        title: '🎉 おめでとう！ 🎉',
        html: `<h2 style="color:${color}">${winnerName}のかち！</h2>`,
        icon: 'success',
        confirmButtonText: 'もういちどあそぶ',
        allowOutsideClick: false
      }).then(() => {
        initGame();
      });
    }

    function showRules() {
      if (typeof Swal === 'undefined') {
        alert('🧊 あそびかた\n1. コマをえらぶ (タップ)\n2. スワイプか矢印キーですべる\n3. 王冠👑をゴール🍧へ！');
        return;
      }
      Swal.fire({
        title: '🧊 あそびかた',
        width: 600,
        html: `
          <div class="rule-modal-container">
            <div class="rule-step">
              <div class="rule-title"><span class="rule-badge">1</span> コマをえらぶ</div>
              <div class="rule-visual">👆 🐧</div>
            </div>
            <div class="rule-step">
              <div class="rule-title"><span class="rule-badge">2</span> スワイプですべる</div>
              <div class="rule-visual">💨 <ruby>氷<rt>こおり</rt></ruby>の<ruby>上<rt>うえ</rt></ruby>をスイスイ！</div>
              <p class="rule-note"><ruby>指<rt>ゆび</rt></ruby>やマウスで<ruby>画面<rt>がめん</rt></ruby>をなぞるか、<ruby>矢印<rt>やじるし</rt></ruby>キーをおしてね</p>
            </div>
            <div class="rule-step" style="border-color:var(--accent-color)">
              <div class="rule-title"><span class="rule-badge">3</span> <ruby>王冠<rt>おうかん</rt></ruby>をゴールへ</div>
              <div class="rule-visual">👑 ➡ 🎯🍧</div>
            </div>
          </div>
        `,
        confirmButtonText: 'わかった！'
      });
    }
  
// ボタンの配線。index.html の onclick= は CSP（script-src 'self'）で
// 実行されないため、ここで繋ぐ。
document.getElementById('btn-reset')?.addEventListener('click', () => initGame());
document.getElementById('btn-random')?.addEventListener('click', () => initRandomGame());
document.getElementById('btn-help')?.addEventListener('click', () => showRules());
