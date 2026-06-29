// ==UserScript==
// @name         京东自动评价（大模型版·全自动闭环）
// @namespace    https://github.com/charmingYouYou/JDAIAutoComment
// @version      8.5
// @description  一个「开始/暂停」按钮控制的全自动评价闭环：评价→自动配图（抓商品晒单图随机上传）→发表→返回列表→进入下一单，循环至列表清空。开始=从当前步骤继续；暂停=当前步骤完成后停止。支持接入各类大模型（DeepSeek/OpenAI/GLM等）。
// @author       charmingYouYou
// @license      MIT
// @homepageURL  https://github.com/charmingYouYou/JDAIAutoComment
// @supportURL   https://github.com/charmingYouYou/JDAIAutoComment/issues
// @icon         https://www.jd.com/favicon.ico
// @noframes
// @match        https://club.jd.com/myJdcomments/orderVoucher*
// @match        https://club.jd.com/myJdcomments/saveCommentSuccess*
// @match        https://club.jd.com/myJdcomments/myJdcomment.action*
// @require      http://libs.baidu.com/jquery/1.11.1/jquery.min.js
// @grant        GM_xmlhttpRequest
// @connect      club.jd.com
// @connect      360buyimg.com
// @connect      img30.360buyimg.com
// @connect      storage.360buyimg.com
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 🛠️ 用户配置区域 ====================

    // 1. 请在此处填入您的 API 密钥 (必填)。出于安全，仓库内不保存真实密钥，请自行填入。
    const API_KEY = '';

    // 2. 接口地址 (默认 DeepSeek 接口，可替换为 OpenAI 或 智谱 GLM 等其他兼容 OpenAI 格式的地址)
    const API_URL = 'http://192.168.2.20:6321/v1/chat/completions';

    // 3. 模型名称
    const MODEL_NAME = 'gpt-5.5';

    // 4. 各环节自动点击前的等待时间（毫秒）
    const AUTO_CLICK_DELAY = 3000;

    // 5. 是否自动配图：发表前抓取该商品晒单图随机上传（false 则跳过配图直接发表）
    const ENABLE_IMAGE = true;

    // 6. 每个商品上传几张晒单图
    const IMG_PER_PRODUCT = 2;

    // 7. 配图上传完成的最长等待（毫秒）。检测不到完成信号时到点即发表，避免卡死
    const UPLOAD_WAIT_TIMEOUT = 12000;

    // =========================================================

    // ==================== 循环 / 暂停 状态 ====================
    // running：循环是否激活，需跨页面跳转存活，故落 localStorage。按钮据此显示「暂停」或「开始」。
    // currentStep：本页加载时算出的"当前步骤"，点「开始」时执行它。
    // resumeAction：暂停停在步骤边界时记下的断点续作，点「开始」优先执行它。
    const LOOP_KEY = 'JD_AI_LOOP_RUNNING';
    let running = false;
    let currentStep = null;
    let resumeAction = null;

    function isRunning() {
        try { return localStorage.getItem(LOOP_KEY) === '1'; } catch (e) { return false; }
    }
    function setRunning(v) {
        running = v;
        try { v ? localStorage.setItem(LOOP_KEY, '1') : localStorage.removeItem(LOOP_KEY); } catch (e) {}
        renderToggleBtn();
    }

    // 步骤边界：每个可被暂停打断的步骤前调用。若已暂停（running=false），记下断点并中止，返回 true。
    function haltIfPaused(resumeFn) {
        if (!running) {
            resumeAction = resumeFn;
            updateStatus('⏸ 已暂停。点击「开始」从当前步骤继续。', '#e4393c');
            return true;
        }
        return false;
    }

    // 1. 创建控制面板 UI
    function createUI() {
        const uiHTML = `
            <div id="ai-auto-review-ui" style="position: fixed; top: 30%; right: 20px; width: 260px; background: #fff; border: 2px solid #e4393c; border-radius: 8px; padding: 15px; z-index: 99999; box-shadow: 0 4px 12px rgba(0,0,0,0.15); font-family: 'Microsoft YaHei', sans-serif;">
                <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #e4393c; text-align: center; border-bottom: 1px solid #eee; padding-bottom: 10px;">🤖 AI 自动评价助手</h3>
                <button id="ai-btn-toggle" style="width: 100%; padding: 10px; background: #28a745; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: bold; margin-bottom: 10px;">开始</button>
                <div id="ai-status" style="font-size: 12px; color: #666; min-height: 40px; background: #f8f8f8; padding: 8px; border-radius: 4px; word-wrap: break-word; line-height: 1.5;">状态：等待页面加载...</div>
            </div>
        `;
        $('body').append(uiHTML);

        // 一个按钮两态：running→「暂停」，停止→「开始」
        $('#ai-btn-toggle').click(function() {
            if (running) {
                // 暂停：跑到下一个步骤边界即停
                setRunning(false);
                updateStatus('⏸ 暂停中…当前步骤完成后停止。', '#e4393c');
            } else {
                // 开始 / 继续：从断点或本页当前步骤继续
                if (!checkConfig()) return;
                setRunning(true);
                updateStatus('▶ 继续执行...', 'blue');
                const fn = resumeAction || currentStep;
                resumeAction = null;
                if (fn) fn();
            }
        });

        renderToggleBtn();
    }

    // 开始/暂停 两态外观
    function renderToggleBtn() {
        const $b = $('#ai-btn-toggle');
        if (!$b.length) return;
        if (running) {
            $b.text('暂停').css('background', '#f0ad4e');
        } else {
            $b.text('开始').css('background', '#28a745');
        }
    }

    // 2. 更新面板状态
    function updateStatus(text, color = '#666') {
        $('#ai-status').text('状态：' + text).css('color', color);
        console.log('[AI Auto Review]', text);
    }

    // 通用：按文案查找可见、可点击的"叶子"元素
    // 用 clone().children().remove().end().text() 取直接文本，避免误命中包含该文案的父容器
    function $clickableByText(text, contains) {
        return $('a, button, span, div, input').filter(':visible').filter(function() {
            const $t = $(this);
            const raw = $t.is('input') ? ($t.val() || '') : $t.clone().children().remove().end().text();
            const t = (raw || '').trim();
            return contains ? t.indexOf(text) !== -1 : t === text;
        });
    }

    // 强制单标签页导航：把点击目标及其祖先链上的 <a>/<form> 的 target 设为 _self，
    // 阻止京东 target="_blank" 链接新开标签页。el 为原生 DOM 元素。
    function forceSameTabNav(el) {
        let node = el;
        while (node && node !== document.body) {
            const tag = node.tagName;
            if (tag === 'A' || tag === 'FORM') {
                node.setAttribute('target', '_self');
            }
            node = node.parentNode;
        }
    }

    // 点击期间临时把 window.open 改成"原地跳转"，兜住京东 onclick 里
    // window.open(...) 程序化开新页。fn 跑完立即还原，并再加 500ms 保险还原（防延迟调用 / finally 漏跑）。
    function withOpenGuard(fn) {
        const orig = window.open;
        let restored = false;
        const restore = function() {
            if (restored) return;
            restored = true;
            window.open = orig;
        };
        window.open = function(url) {
            try { if (url) location.href = url; } catch (e) {}
            return null;
        };
        try {
            fn();
        } finally {
            restore();
            setTimeout(restore, 500);
        }
    }

    // 通用：倒计时后自动点击目标元素。getEl 每次回调时重新求值，确保拿到最新 DOM。
    // 点击前是一个暂停边界；找不到目标则停止（onNotFound 可定制收尾，如结束循环）。
    function autoClickAfter(getEl, label, delay, onNotFound) {
        delay = (delay == null) ? AUTO_CLICK_DELAY : delay;
        let remain = Math.ceil(delay / 1000);
        if (remain > 0) updateStatus(`${label}：${remain}秒后自动点击...`, 'blue');

        const timer = setInterval(function() {
            remain--;
            if (remain > 0) updateStatus(`${label}：${remain}秒后自动点击...`, 'blue');
        }, 1000);

        setTimeout(function() {
            clearInterval(timer);
            // 暂停边界：恢复时重跑本次点击（delay=0 立即执行）
            if (haltIfPaused(function() { autoClickAfter(getEl, label, 0, onNotFound); })) return;

            const $el = getEl();
            if ($el && $el.length > 0) {
                updateStatus(`${label}：已自动点击 ✅`, 'green');
                $el[0].click();
            } else {
                updateStatus(`${label}：未找到目标元素，流程已停止。`, 'red');
                if (onNotFound) onNotFound();
            }
        }, delay);
    }

    // 3. 校验用户是否配置了秘钥
    function checkConfig() {
        if (!API_KEY || API_KEY === '请在此处填入你的API密钥' || API_KEY.trim() === '') {
            updateStatus('❌ 错误：请先在油猴脚本代码中配置您的 API_KEY！', 'red');
            return false;
        }
        return true;
    }

    // 4. 请求 大模型 API
    function generateProductReview(productName, successCallback, errorCallback) {
        console.log('productName', productName);
        GM_xmlhttpRequest({
            method: "POST",
            url: API_URL,
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + API_KEY
            },
            data: JSON.stringify({
                model: MODEL_NAME,
                messages: [
                    {
                        role: "system",
                        content: "你是一名真实的网购买家。我刚买了商品，商品全称是:【" + productName + "】。\n\n请写一段60到100字的商品评价，严格遵守以下纪律：\n1. 必须根据名称推断出它具体是什么东西（比如是保鲜膜、垃圾袋还是零食），然后只评价它该有的特定属性（如保鲜膜就评价粘性/厚度/好撕，垃圾袋评价承重/不漏）。\n2. 绝对禁止使用“物流快”、“客服好”、“包装严实”等万能模板废话。\n3. 不要把商品全名抄一遍，用“这款”、“这个”代替。\n4. 字数必须大于60个字。直接输出纯文本正文，绝对不要有任何前缀或提示语。"
                    }
                ]
            }),
            onload: function(response) {
                console.log(response)
                try {
                    const result = JSON.parse(response.responseText);
                    if (result.error) {
                        errorCallback(result.error.message || result.error.code || 'API 拒绝请求');
                        return;
                    }
                    const review = result.choices && result.choices.length > 0 ? result.choices[0].message.content : "";
                    if(review && review.length > 5) {
                        successCallback(review.trim());
                    } else {
                        errorCallback('返回内容过短或为空');
                    }
                } catch(e) {
                    errorCallback('解析服务器响应失败');
                }
            },
            onerror: function(error) {
                errorCallback('请求超时或网络错误');
            }
        });
    }

    // 解析"发表"按钮：优先精确文案"发表"，找不到再退化为包含"发表"（兼容"发表评价"）。该页发表按钮唯一，取 first。
    function resolvePublishBtn() {
        let $btn = $clickableByText('发表', false);
        if ($btn.length === 0) $btn = $clickableByText('发表', true);
        return $btn.first();
    }

    // ==================== 自动配图（抓商品晒单图随机上传） ====================
    // 数据源：club.jd.com 同域晒单图接口（按 skuId 取 JSON，避开详情页风控与 JS 渲染）。
    // 上传：.btn-upload 底层是 plupload(html5) 的原生 <input type=file>，
    //       用 DataTransfer 写 input.files + dispatch change 触发上传（已实测可用），绕过系统文件框。

    // 发表步骤（含暂停边界）
    function publishStep() {
        if (haltIfPaused(publishStep)) return;
        autoClickAfter(resolvePublishBtn, '自动发表评价');
    }

    // 洗牌取前 n 个
    function pickRandom(arr, n) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a.slice(0, n);
    }

    // 按 skuId 取晒单图 URL 列表（同域 fetch）
    function fetchShaidanImages(sku) {
        const api = 'https://club.jd.com/discussion/getProductPageImageCommentList.action?productId=' +
                    sku + '&isShadowSku=0&page=1&pageSize=10';
        return fetch(api, { credentials: 'include' })
            .then(function(r) { return r.json(); })
            .then(function(d) {
                return (d && d.imgComments && d.imgComments.imgList)
                    ? d.imgComments.imgList.map(function(x) { return x.imageUrl; }).filter(Boolean)
                    : [];
            })
            .catch(function() { return []; });
    }

    // 跨域抓图为 Blob（图片在 360buyimg.com，需 GM_xmlhttpRequest + @connect）
    function fetchImageBlob(url) {
        return new Promise(function(resolve, reject) {
            GM_xmlhttpRequest({
                method: 'GET', url: url, responseType: 'blob',
                onload: function(r) {
                    (r.status >= 200 && r.status < 300 && r.response) ? resolve(r.response) : reject('HTTP ' + r.status);
                },
                onerror: function() { reject('网络错误'); },
                ontimeout: function() { reject('超时'); }
            });
        });
    }

    // 把任意格式的图片 Blob 重新编码成真 JPEG File。
    // 必要性：360buyimg CDN 对 .jpg 晒单图常按内容协商返回 webp 字节，京东上传按 magic bytes
    // 校验会判定非 jpg/png/gif/bmp 而拒收。经 canvas 重编码可保证为真 JPEG，并顺带限制尺寸 (<4M)。
    // 关键：blob 经 blob: URL 加载到 Image 属同源，不会污染 canvas，toBlob 可正常导出。
    function blobToJpegFile(blob, name) {
        return new Promise(function(resolve, reject) {
            const objUrl = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = function() {
                URL.revokeObjectURL(objUrl);
                let w = img.naturalWidth, h = img.naturalHeight;
                if (!w || !h) { reject('图片尺寸为 0'); return; }
                const MAX = 1920; // 限制最长边，保证 JPEG 体积远小于 4M
                if (Math.max(w, h) > MAX) {
                    const s = MAX / Math.max(w, h);
                    w = Math.round(w * s); h = Math.round(h * s);
                }
                const cv = document.createElement('canvas');
                cv.width = w; cv.height = h;
                const ctx = cv.getContext('2d');
                ctx.fillStyle = '#ffffff'; // 白底，避免透明图转 jpg 出现黑块
                ctx.fillRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                cv.toBlob(function(jpg) {
                    jpg ? resolve(new File([jpg], name, { type: 'image/jpeg' })) : reject('toBlob 失败');
                }, 'image/jpeg', 0.85);
            };
            img.onerror = function() { URL.revokeObjectURL(objUrl); reject('图片解码失败'); };
            img.src = objUrl;
        });
    }

    // 把若干 File 注入到指定 file input 并触发 plupload 上传
    function injectFiles(input, files) {
        const dt = new DataTransfer();
        files.forEach(function(f) { dt.items.add(f); });
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 把 skuId 映射到对应商品的 file input：用 .btn-upload(#image-upload-<sku>) 与 input 的几何重叠定位
    function findFileInputForSku(sku) {
        const inputs = Array.prototype.slice.call(document.querySelectorAll('input[type="file"]'));
        if (inputs.length <= 1) return inputs[0] || null;
        const span = document.getElementById('image-upload-' + sku);
        if (!span) return inputs[0];
        const r = span.getBoundingClientRect();
        let best = inputs[0], bestArea = -1;
        inputs.forEach(function(inp) {
            const ir = inp.getBoundingClientRect();
            const ox = Math.max(0, Math.min(r.right, ir.right) - Math.max(r.left, ir.left));
            const oy = Math.max(0, Math.min(r.bottom, ir.bottom) - Math.max(r.top, ir.top));
            const area = ox * oy;
            if (area > bestArea) { bestArea = area; best = inp; }
        });
        return best;
    }

    // 收集本页所有商品（sku + 对应 file input），按 sku 去重
    function collectProducts() {
        const seen = {}, products = [];
        document.querySelectorAll('.p-name a').forEach(function(a) {
            const href = a.getAttribute('href') || '';
            const m = href.match(/item\.jd\.com\/(\d+)\.html/);
            if (m && !seen[m[1]]) {
                seen[m[1]] = 1;
                products.push({ sku: m[1], input: findFileInputForSku(m[1]) });
            }
        });
        return products;
    }

    // 单个商品：抓晒单图 → 随机取 N 张 → 下载为 File → 注入上传。返回成功注入的张数。
    function uploadForProduct(p) {
        updateStatus('配图：抓取 sku ' + p.sku + ' 晒单图...', 'blue');
        return fetchShaidanImages(p.sku).then(function(urls) {
            if (!urls.length) { updateStatus('sku ' + p.sku + ' 无晒单图，跳过配图', '#e4393c'); return 0; }
            const picks = pickRandom(urls, IMG_PER_PRODUCT);
            const tasks = picks.map(function(u, i) {
                let url = u.indexOf('//') === 0 ? 'https:' + u : u;
                url = url.replace(/\.dpg(\?|$)/, '$1'); // 去 .dpg 保险（接口一般已是 .jpg）
                return fetchImageBlob(url)
                    .then(function(blob) { return blobToJpegFile(blob, 'shaidan_' + p.sku + '_' + i + '.jpg'); })
                    .catch(function() { return null; });
            });
            return Promise.all(tasks).then(function(files) {
                files = files.filter(Boolean);
                if (!files.length || !p.input) {
                    updateStatus('sku ' + p.sku + ' 配图未完成(input=' + (!!p.input) + ', files=' + files.length + ')', '#e4393c');
                    return 0;
                }
                injectFiles(p.input, files);
                updateStatus('sku ' + p.sku + ' 已注入 ' + files.length + ' 张图，上传中...', 'green');
                return files.length;
            });
        });
    }

    // 等待上传完成：检测页面出现已上传图（i.imageUpload）数 ≥ 期望张数；到点即返回，避免卡死
    function waitUploads(min, timeout) {
        return new Promise(function(resolve) {
            const start = Date.now();
            const iv = setInterval(function() {
                const n = document.querySelectorAll('img[src*="imageUpload"]').length;
                if (n >= min || (Date.now() - start) > timeout) { clearInterval(iv); resolve(n); }
            }, 600);
        });
    }

    // 配图主流程：逐商品配图 → 等上传 → 发表。任何异常都跳过配图直接发表，不阻断闭环。
    function uploadImagesThenPublish() {
        if (haltIfPaused(uploadImagesThenPublish)) return;
        const products = collectProducts();
        if (!products.length) { publishStep(); return; }

        let expected = 0;
        // 串行处理各商品，便于暂停与状态显示
        const chain = products.reduce(function(prev, p) {
            return prev.then(function() {
                if (!running) { resumeAction = uploadImagesThenPublish; updateStatus('⏸ 已暂停。', '#e4393c'); throw 'PAUSED'; }
                return uploadForProduct(p).then(function(n) { expected += n; });
            });
        }, Promise.resolve());

        chain.then(function() {
            if (expected > 0) {
                updateStatus('共注入 ' + expected + ' 张晒单图，等待上传完成...', 'blue');
                return waitUploads(expected, UPLOAD_WAIT_TIMEOUT);
            }
        }).then(function() {
            publishStep();
        }).catch(function(e) {
            if (e === 'PAUSED') return; // 暂停：已记录断点，等「开始」
            updateStatus('配图异常，跳过配图直接发表：' + e, 'red');
            publishStep();
        });
    }

    // 5. 递归处理每一个可见的商品
    function processNextItem(index) {
        let $textareas = $('.f-textarea textarea').filter(':visible');
        let $names = $('.p-name').filter(':visible');

        if (index >= $textareas.length) {
            $('.star5:visible').click(); // 统一打五星
            // 回填完毕：先配图（可选），再发表。两步均含暂停边界。
            if (ENABLE_IMAGE) {
                updateStatus('✅ 评价已生成并打五星，开始自动配图...', 'green');
                uploadImagesThenPublish();
            } else {
                updateStatus('✅ 评价生成完毕，已打五星，准备自动发表...', 'green');
                publishStep();
            }
            return;
        }

        // 暂停边界：完成上一条、开始下一条之前
        if (haltIfPaused(function() { processNextItem(index); })) return;

        let nameNode = $names.eq(index);
        let productName = nameNode.find('a').text().trim() || nameNode.text().trim() || "未知商品";
        let shortName = productName.length > 15 ? productName.substring(0, 15) + '...' : productName;

        updateStatus(`正在生成 ${index + 1}/${$textareas.length}: ${shortName}`, 'blue');

        generateProductReview(productName,
            function(review) {
                let $currentTarget = $textareas.eq(index);
                $currentTarget.val(review);
                if ($currentTarget.length > 0) {
                    $currentTarget[0].dispatchEvent(new Event('input', { bubbles: true }));
                    $currentTarget[0].dispatchEvent(new Event('change', { bubbles: true }));
                }

                setTimeout(function() {
                    processNextItem(index + 1);
                }, 1500);
            },
            function(errMsg) {
                // AI 生成失败：不兜底，直接暂停并说明原因。点「开始」从当前商品重试。
                setRunning(false);
                resumeAction = function() { processNextItem(index); };
                updateStatus(`❌ 第 ${index + 1} 个商品评价生成失败：${errMsg}。已暂停，排查后点「开始」重试。`, 'red');
            }
        );
    }

    // orderVoucher 评价页步骤：生成所有评价并发表
    function startReviewProcess() {
        if (!checkConfig()) return;

        let $textareas = $('.f-textarea textarea').filter(':visible');
        if ($textareas.length === 0) {
            updateStatus('未检测到可见的评价输入框，请确保当前在评价页面。', 'red');
            return;
        }

        updateStatus(`检测到 ${$textareas.length} 个商品，准备开始处理...`, 'blue');
        processNextItem(0);
    }

    // 我的评价列表页步骤：点击 .operate 下"评价"按钮（第一条待评价订单）。列表为空 → 结束循环。
    function runListStep() {
        autoClickAfter(function() {
            let $btn = $('.operate').find('a, button, span').filter(':visible').filter(function() {
                return $(this).clone().children().remove().end().text().trim() === '评价';
            });
            if ($btn.length === 0) {
                // 兜底：退化为"去评价"，排除"查看评价/追评"
                $btn = $('.operate').find('a, button').filter(':visible').filter(function() {
                    const t = $(this).text().trim();
                    return t === '评价' || t.indexOf('去评价') !== -1;
                });
            }
            return $btn.first();
        }, '进入下一单评价', AUTO_CLICK_DELAY, function() {
            setRunning(false);
            updateStatus('🎉 待评价列表已空，循环结束。', 'green');
        });
    }

    // 评价成功页步骤：点击"返回待评价列表 >"
    function successReturnStep() {
        autoClickAfter(function() {
            return $clickableByText('返回待评价列表', true).first();
        }, '返回待评价列表');
    }

    // 6. 页面加载完成后按路由分发：算出本页 currentStep，running 则自动执行，否则等「开始」
    $(document).ready(function() {
        createUI();
        running = isRunning();
        renderToggleBtn();

        const path = location.pathname;

        if (path.indexOf('/saveCommentSuccess') !== -1) {
            currentStep = successReturnStep;
        } else if (path.indexOf('/myJdcomment.action') !== -1) {
            currentStep = runListStep;
        } else {
            // orderVoucher 评价页
            currentStep = startReviewProcess;
        }

        if (running) {
            // 循环中：自动执行本页步骤。评价页留 2.5s 等 DOM 就绪，其余步骤自带倒计时。
            if (currentStep === startReviewProcess) {
                if (!checkConfig()) return;
                updateStatus('循环中，2秒后开始本单评价...', 'blue');
                setTimeout(function() { if (running) startReviewProcess(); }, 2500);
            } else {
                currentStep();
            }
        } else {
            updateStatus('点击「开始」启动 / 继续自动评价循环。', 'blue');
        }
    });
})();
