(function () {
    'use strict';

    // =========================================================================
    // ⭐ Google Apps Script 웹 앱 배포 URL을 입력하세요 ⭐
    // =========================================================================
    var GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbypCQOcAoeB1Sqg_5Vs17k2YarmNY1FwNyTgD02l_At-wfR9SD0k2zksphQ82UoZIYD/exec';

    // =========================================================================
    // 상태 변수
    // =========================================================================
    var currentStudent = null;
    var currentGroupInfo = null;
    var maxAiCount = 7;
    var aiUsedCount = 0;
    var chatHistory = [];
    var aiLogs = [];
    var attachedMedia = null;

    var mediaRecorder = null;
    var audioChunks = [];
    var isRecording = false;

    var adminStudents = [];
    var yearMap = {};

    // =========================================================================
    // 공통 API 호출 & 알림
    // =========================================================================
    function showCustomAlert(title, message) {
        document.getElementById('customAlertTitle').textContent = title;
        document.getElementById('customAlertMessage').textContent = message;
        document.getElementById('customAlertOverlay').style.display = 'flex';
    }

    function callApi(payload) {
        if (!GAS_WEB_APP_URL || GAS_WEB_APP_URL.indexOf('http') !== 0) {
            return Promise.reject(new Error('main.js에 GAS 웹 앱 URL을 먼저 입력해 주세요.'));
        }
        return fetch(GAS_WEB_APP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload),
            redirect: 'follow'
        }).then(function (res) {
            if (!res.ok) throw new Error('서버 오류: ' + res.status);
            return res.json();
        }).then(function (data) {
            if (!data.success) throw new Error(data.error || '처리 실패');
            return data;
        });
    }

    // =========================================================================
    // 학년도 / 반 목록 불러오기
    // =========================================================================
    function loadMeta() {
        if (!GAS_WEB_APP_URL || GAS_WEB_APP_URL.indexOf('http') !== 0) return;
        callApi({ action: 'getMeta' }).then(function (data) {
            yearMap = data.yearMap || {};
            var yearList = document.getElementById('yearList');
            yearList.innerHTML = (data.years || []).map(function (y) {
                return '<option value="' + y + '"></option>';
            }).join('');
            if (data.years && data.years.length > 0) {
                document.getElementById('regYear').value = data.years[0];
                document.getElementById('admYear').value = data.years[0];
                updateClassDatalist(data.years[0]);
            }
        }).catch(function () {});
    }

    function updateClassDatalist(year) {
        var list = yearMap[year] || [];
        document.getElementById('classList').innerHTML = list.map(function (c) {
            return '<option value="' + c + '"></option>';
        }).join('');
    }

    // =========================================================================
    // 인증 (로그인 / 회원가입 / 관리자)
    // =========================================================================
    function switchAuthTab(tab) {
        document.querySelectorAll('[data-auth-tab]').forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-auth-tab') === tab);
        });
        document.getElementById('tabLogin').classList.toggle('hidden', tab !== 'login');
        document.getElementById('tabRegister').classList.toggle('hidden', tab !== 'register');
        document.getElementById('tabAdmin').classList.toggle('hidden', tab !== 'admin');
    }

    function handleRegister() {
        var btn = document.getElementById('btnRegister');
        btn.disabled = true;
        btn.textContent = '처리 중...';

        callApi({
            action: 'register',
            year: document.getElementById('regYear').value.trim(),
            className: document.getElementById('regClass').value.trim(),
            studentId: document.getElementById('regId').value.trim(),
            name: document.getElementById('regName').value.trim(),
            password: document.getElementById('regPw').value.trim()
        }).then(function (data) {
            showCustomAlert('가입 완료', data.message);
            document.getElementById('loginId').value = document.getElementById('regId').value.trim();
            document.getElementById('loginName').value = document.getElementById('regName').value.trim();
            switchAuthTab('login');
        }).catch(function (err) {
            showCustomAlert('오류', err.message);
        }).then(function () {
            btn.disabled = false;
            btn.textContent = '가입하기';
        });
    }

    function handleLogin() {
        var btn = document.getElementById('btnLogin');
        btn.disabled = true;
        btn.textContent = '확인 중...';

        callApi({
            action: 'login',
            studentId: document.getElementById('loginId').value.trim(),
            name: document.getElementById('loginName').value.trim(),
            password: document.getElementById('loginPw').value.trim()
        }).then(function (data) {
            currentStudent = data.student;
            currentGroupInfo = data.groupInfo || { group: '', role: '질문 해결', assignedQuestion: '' };
            maxAiCount = data.maxAiCount || 7;
            aiUsedCount = 0;
            chatHistory = [];
            aiLogs = [];
            attachedMedia = null;

            enterStudentView();
        }).catch(function (err) {
            showCustomAlert('로그인 실패', err.message);
        }).then(function () {
            btn.disabled = false;
            btn.textContent = '로그인';
        });
    }

    function handleAdminLogin() {
        callApi({
            action: 'adminLogin',
            password: document.getElementById('adminPw').value.trim()
        }).then(function () {
            document.getElementById('authSection').classList.add('hidden');
            document.getElementById('adminSection').classList.remove('hidden');
        }).catch(function (err) {
            showCustomAlert('접속 실패', err.message);
        });
    }

    // =========================================================================
    // 학생 화면
    // =========================================================================
    function enterStudentView() {
        document.getElementById('authSection').classList.add('hidden');
        document.getElementById('studentSection').classList.remove('hidden');

        document.getElementById('stInfoPill').textContent =
            currentStudent.studentId + ' ' + currentStudent.name;
        document.getElementById('stGroupPill').textContent =
            currentGroupInfo.group ? (currentGroupInfo.group + '조') : '미배정';
        document.getElementById('stRolePill').textContent =
            '역할: ' + (currentGroupInfo.role || '질문 해결');
        document.getElementById('aiPanelTitle').textContent =
            'AI 도우미 (' + (currentGroupInfo.role || '질문 해결') + ')';
        document.getElementById('assignedQuestionBox').textContent =
            currentGroupInfo.assignedQuestion || '배정된 질문 없음';

        document.getElementById('chatBox').innerHTML = '';
        document.getElementById('workEditor').value = '';
        document.getElementById('mediaFileName').textContent = '';
        updateAiCountUI();
    }

    function updateAiCountUI() {
        var remain = Math.max(0, maxAiCount - aiUsedCount);
        document.getElementById('stAiCountPill').textContent = 'AI ' + aiUsedCount + ' / ' + maxAiCount;
        document.getElementById('aiRemainBadge').textContent = '남은 질문 ' + remain + '회';
        document.getElementById('btnAiSend').disabled = remain <= 0;
    }

    function appendChatMessage(sender, text) {
        var box = document.getElementById('chatBox');
        var div = document.createElement('div');
        div.className = 'msg ' + (sender === 'user' ? 'msg-user' : 'msg-ai');
        div.textContent = text;

        if (sender === 'ai') {
            var wrap = document.createElement('div');
            wrap.className = 'msg-apply-wrap';
            var btn = document.createElement('button');
            btn.className = 'btn btn-outline btn-sm';
            btn.textContent = '반영';
            btn.addEventListener('click', function () {
                var editor = document.getElementById('workEditor');
                editor.value = editor.value ? (editor.value + '\n\n' + text) : text;
            });
            wrap.appendChild(btn);
            div.appendChild(wrap);
        }

        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    }

    function sendAiQuestion() {
        var input = document.getElementById('aiInput');
        var text = input.value.trim();
        if (!text) return;
        if (aiUsedCount >= maxAiCount) {
            showCustomAlert('제한', '질문 횟수(7회)를 모두 사용했습니다.');
            return;
        }

        appendChatMessage('user', text);
        input.value = '';
        chatHistory.push({ role: 'user', parts: [{ text: text }] });

        var btn = document.getElementById('btnAiSend');
        btn.disabled = true;
        btn.textContent = '...';

        callApi({
            action: 'aiChat',
            role: currentGroupInfo.role,
            chatHistory: chatHistory,
            usedCount: aiUsedCount
        }).then(function (data) {
            aiUsedCount = data.usedCount;
            chatHistory.push({ role: 'model', parts: [{ text: data.text }] });
            aiLogs.push({ q: text, a: data.text });
            appendChatMessage('ai', data.text);
            updateAiCountUI();
        }).catch(function (err) {
            showCustomAlert('AI 오류', err.message);
        }).then(function () {
            btn.textContent = '전송';
            updateAiCountUI();
        });
    }

    function handleMediaSelect(e) {
        var file = e.target.files[0];
        if (!file) return;
        if (file.size > 15 * 1024 * 1024) {
            showCustomAlert('용량 초과', '15MB 이하 파일만 첨부할 수 있습니다.');
            e.target.value = '';
            return;
        }
        var reader = new FileReader();
        reader.onload = function (ev) {
            attachedMedia = {
                name: file.name,
                mimeType: file.type || 'application/octet-stream',
                data: ev.target.result.split(',')[1]
            };
            document.getElementById('mediaFileName').textContent = file.name;
        };
        reader.readAsDataURL(file);
    }

    function handleSubmitWork() {
        var finalText = document.getElementById('workEditor').value.trim();
        if (!finalText && aiLogs.length === 0) {
            showCustomAlert('확인', '작성한 내용이 없습니다.');
            return;
        }

        var btn = document.getElementById('btnSubmitWork');
        btn.disabled = true;
        btn.textContent = '저장 중...';

        callApi({
            action: 'submitWork',
            student: currentStudent,
            group: currentGroupInfo.group,
            role: currentGroupInfo.role,
            assignedQuestion: currentGroupInfo.assignedQuestion,
            aiLogs: aiLogs,
            finalText: finalText,
            attachment: attachedMedia
        }).then(function () {
            showCustomAlert('저장 완료', '구글 문서에 기록되었습니다.');
            attachedMedia = null;
            document.getElementById('mediaFileName').textContent = '';
            document.getElementById('mediaInput').value = '';
        }).catch(function (err) {
            showCustomAlert('저장 실패', err.message);
        }).then(function () {
            btn.disabled = false;
            btn.textContent = '문서 전송';
        });
    }

    function toggleRecording() {
        var btn = document.getElementById('btnRecToggle');
        if (isRecording && mediaRecorder) {
            mediaRecorder.stop();
            isRecording = false;
            btn.textContent = '저장 중...';
            btn.disabled = true;
            return;
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showCustomAlert('오류', '마이크를 사용할 수 없는 환경입니다.');
            return;
        }

        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
            audioChunks = [];
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = function (e) {
                if (e.data.size > 0) audioChunks.push(e.data);
            };
            mediaRecorder.onstop = function () {
                stream.getTracks().forEach(function (t) { t.stop(); });
                var blob = new Blob(audioChunks, { type: 'audio/webm' });
                var reader = new FileReader();
                reader.onloadend = function () {
                    var base64 = reader.result.split(',')[1];
                    callApi({
                        action: 'uploadAudio',
                        student: currentStudent,
                        group: currentGroupInfo.group,
                        mimeType: 'audio/webm',
                        audioBase64: base64
                    }).then(function (data) {
                        showCustomAlert('발표 저장 완료', '음성과 텍스트가 문서에 기록되었습니다.');
                        var editor = document.getElementById('workEditor');
                        if (data.transcript) {
                            editor.value = editor.value ? (editor.value + '\n\n[발표]\n' + data.transcript) : data.transcript;
                        }
                    }).catch(function (err) {
                        showCustomAlert('저장 실패', err.message);
                    }).then(function () {
                        btn.disabled = false;
                        btn.textContent = '🎙️ 발표 녹음';
                        btn.classList.remove('btn-danger');
                        btn.classList.add('btn-outline');
                    });
                };
                reader.readAsDataURL(blob);
            };
            mediaRecorder.start();
            isRecording = true;
            btn.textContent = '녹음 종료';
            btn.classList.remove('btn-outline');
            btn.classList.add('btn-danger');
        }).catch(function () {
            showCustomAlert('마이크 오류', '마이크 권한을 허용해 주세요.');
        });
    }

    function handleSubmitQuestion() {
        var unit = document.getElementById('qUnit').value.trim();
        var q1 = document.getElementById('qText1').value.trim();
        var q2 = document.getElementById('qText2').value.trim();

        callApi({
            action: 'submitQuestion',
            student: currentStudent,
            unit: unit,
            questions: [q1, q2]
        }).then(function () {
            showCustomAlert('등록 완료', '질문이 저장되었습니다.');
            document.getElementById('qText1').value = '';
            document.getElementById('qText2').value = '';
        }).catch(function (err) {
            showCustomAlert('등록 실패', err.message);
        });
    }

    // =========================================================================
    // 관리자 화면
    // =========================================================================
    function loadAdminClassData() {
        var year = document.getElementById('admYear').value.trim();
        var className = document.getElementById('admClass').value.trim();
        if (!year || !className) {
            showCustomAlert('확인', '학년도와 반을 입력해 주세요.');
            return;
        }

        callApi({
            action: 'adminGetClassData',
            year: year,
            className: className
        }).then(function (data) {
            adminStudents = data.students || [];
            renderAdminGroups(data.currentGroups || []);
            renderAdminObs(adminStudents);
            renderSaengibuSelect(adminStudents);
        }).catch(function (err) {
            showCustomAlert('오류', err.message);
        });
    }

    function renderAdminGroups(groups) {
        var tbody = document.getElementById('admGroupBody');
        if (!groups.length) {
            tbody.innerHTML = '<tr><td colspan="5">편성 기록이 없습니다.</td></tr>';
            return;
        }
        tbody.innerHTML = groups.map(function (g) {
            return '<tr>'
                + '<td><strong>' + g.group + '조</strong></td>'
                + '<td>' + g.studentId + '</td>'
                + '<td>' + g.name + '</td>'
                + '<td>' + g.role + '</td>'
                + '<td style="text-align:left;">' + (g.assignedQuestion || '-') + '</td>'
                + '</tr>';
        }).join('');
    }

    function renderAdminObs(students) {
        var tbody = document.getElementById('admObsBody');
        if (!students.length) {
            tbody.innerHTML = '<tr><td colspan="5">가입된 학생이 없습니다.</td></tr>';
            return;
        }
        tbody.innerHTML = students.map(function (s, idx) {
            return '<tr>'
                + '<td>' + s.studentId + '</td>'
                + '<td>' + s.name + '</td>'
                + '<td><select id="obsLevel_' + idx + '"><option>상</option><option selected>중</option><option>하</option></select></td>'
                + '<td><input type="text" id="obsNote_' + idx + '" placeholder="특이사항 입력" /></td>'
                + '<td><button class="btn btn-primary btn-sm" data-obs-idx="' + idx + '">저장</button></td>'
                + '</tr>';
        }).join('');
    }

    function renderSaengibuSelect(students) {
        var sel = document.getElementById('sbStudentSelect');
        sel.innerHTML = students.map(function (s, idx) {
            return '<option value="' + idx + '">' + s.studentId + ' ' + s.name + '</option>';
        }).join('');
    }

    function assignGroups(mode) {
        var year = document.getElementById('admYear').value.trim();
        var className = document.getElementById('admClass').value.trim();
        callApi({
            action: 'adminAssignGroups',
            year: year,
            className: className,
            mode: mode
        }).then(function (data) {
            renderAdminGroups(data.currentGroups || []);
            showCustomAlert('완료', '조 편성이 시트에 기록되었습니다.');
        }).catch(function (err) {
            showCustomAlert('오류', err.message);
        });
    }

    function createSlides() {
        var year = document.getElementById('admYear').value.trim();
        var className = document.getElementById('admClass').value.trim();
        callApi({
            action: 'adminCreateSlides',
            year: year,
            className: className
        }).then(function (data) {
            showCustomAlert('슬라이드 생성 완료', '새 창에서 슬라이드가 열립니다.');
            if (data.slideUrl) window.open(data.slideUrl, '_blank');
        }).catch(function (err) {
            showCustomAlert('생성 실패', err.message);
        });
    }

    function generateSaengibu() {
        var idx = Number(document.getElementById('sbStudentSelect').value);
        var st = adminStudents[idx];
        if (!st) {
            showCustomAlert('확인', '학생을 선택해 주세요.');
            return;
        }
        st.year = document.getElementById('admYear').value.trim();
        st.className = document.getElementById('admClass').value.trim();

        var btn = document.getElementById('btnGenSaengibu');
        btn.disabled = true;
        btn.textContent = '생성 중...';

        callApi({
            action: 'adminGenerateSaengibu',
            student: st,
            rubric: document.getElementById('sbRubric').value.trim()
        }).then(function (data) {
            document.getElementById('sbOutput').value = data.text;
        }).catch(function (err) {
            showCustomAlert('생성 실패', err.message);
        }).then(function () {
            btn.disabled = false;
            btn.textContent = '문구 생성';
        });
    }

    // =========================================================================
    // 초기화
    // =========================================================================
    function initApp() {
        loadMeta();

        // 인증 탭
        document.querySelectorAll('[data-auth-tab]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                switchAuthTab(btn.getAttribute('data-auth-tab'));
            });
        });

        document.getElementById('regYear').addEventListener('input', function (e) {
            updateClassDatalist(e.target.value.trim());
        });
        document.getElementById('admYear').addEventListener('input', function (e) {
            updateClassDatalist(e.target.value.trim());
        });

        document.getElementById('btnRegister').addEventListener('click', handleRegister);
        document.getElementById('btnLogin').addEventListener('click', handleLogin);
        document.getElementById('btnAdminLogin').addEventListener('click', handleAdminLogin);

        // 학생 탭
        document.querySelectorAll('[data-st-tab]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var target = btn.getAttribute('data-st-tab');
                document.querySelectorAll('[data-st-tab]').forEach(function (b) {
                    b.classList.toggle('active', b === btn);
                });
                document.getElementById('stWorkTab').classList.toggle('hidden', target !== 'work');
                document.getElementById('stQuestionTab').classList.toggle('hidden', target !== 'question');
            });
        });

        document.getElementById('btnLogout').addEventListener('click', function () {
            currentStudent = null;
            document.getElementById('studentSection').classList.add('hidden');
            document.getElementById('authSection').classList.remove('hidden');
        });

        // AI 및 작성 영역
        document.getElementById('btnAiSend').addEventListener('click', sendAiQuestion);
        document.getElementById('aiInput').addEventListener('keypress', function (e) {
            if (e.key === 'Enter') sendAiQuestion();
        });

        // 텍스트 복사·붙여넣기·드롭 차단
        var editor = document.getElementById('workEditor');
        ['paste', 'copy', 'cut', 'drop'].forEach(function (evt) {
            editor.addEventListener(evt, function (e) {
                e.preventDefault();
                showCustomAlert('제한', '직접 입력하거나 AI [반영] 버튼을 사용해 주세요.');
            });
        });

        document.getElementById('btnAttachMedia').addEventListener('click', function () {
            document.getElementById('mediaInput').click();
        });
        document.getElementById('mediaInput').addEventListener('change', handleMediaSelect);
        document.getElementById('btnRecToggle').addEventListener('click', toggleRecording);
        document.getElementById('btnSubmitWork').addEventListener('click', handleSubmitWork);
        document.getElementById('btnSubmitQuestion').addEventListener('click', handleSubmitQuestion);

        // 관리자 탭
        document.querySelectorAll('[data-adm-tab]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var target = btn.getAttribute('data-adm-tab');
                document.querySelectorAll('[data-adm-tab]').forEach(function (b) {
                    b.classList.toggle('active', b === btn);
                });
                document.getElementById('admGroupTab').classList.toggle('hidden', target !== 'group');
                document.getElementById('admObsTab').classList.toggle('hidden', target !== 'obs');
                document.getElementById('admSaengibuTab').classList.toggle('hidden', target !== 'saengibu');
            });
        });

        document.getElementById('btnAdminLogout').addEventListener('click', function () {
            document.getElementById('adminSection').classList.add('hidden');
            document.getElementById('authSection').classList.remove('hidden');
        });
        document.getElementById('btnAdmLoad').addEventListener('click', loadAdminClassData);
        document.getElementById('btnRotateRoles').addEventListener('click', function () { assignGroups('rotate'); });
        document.getElementById('btnShuffleGroups').addEventListener('click', function () { assignGroups('shuffle'); });
        document.getElementById('btnCreateSlides').addEventListener('click', createSlides);

        document.getElementById('admObsBody').addEventListener('click', function (e) {
            var btn = e.target.closest('button[data-obs-idx]');
            if (!btn) return;
            var idx = Number(btn.getAttribute('data-obs-idx'));
            var st = adminStudents[idx];
            callApi({
                action: 'adminSaveObservation',
                year: document.getElementById('admYear').value.trim(),
                className: document.getElementById('admClass').value.trim(),
                studentId: st.studentId,
                name: st.name,
                level: document.getElementById('obsLevel_' + idx).value,
                note: document.getElementById('obsNote_' + idx).value.trim()
            }).then(function () {
                showCustomAlert('저장 완료', st.name + ' 관찰 기록이 저장되었습니다.');
            }).catch(function (err) {
                showCustomAlert('오류', err.message);
            });
        });

        document.getElementById('btnGenSaengibu').addEventListener('click', generateSaengibu);
        document.getElementById('btnCopySaengibu').addEventListener('click', function () {
            var out = document.getElementById('sbOutput');
            out.select();
            navigator.clipboard.writeText(out.value).then(function () {
                showCustomAlert('복사 완료', '클립보드에 복사되었습니다.');
            });
        });

        // 사용법 & 커스텀 알림 모달
        var helpModal = document.getElementById('helpModal');
        document.getElementById('btnHelp').addEventListener('click', function () {
            helpModal.style.display = 'flex';
        });
        document.getElementById('btnHelpClose').addEventListener('click', function () {
            helpModal.style.display = 'none';
        });
        window.addEventListener('click', function (e) {
            if (e.target === helpModal) helpModal.style.display = 'none';
        });
        document.getElementById('btnCustomAlertClose').addEventListener('click', function () {
            document.getElementById('customAlertOverlay').style.display = 'none';
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
})();
