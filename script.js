// ========== 全局配置对象（所有配置从JSON文件加载） ==========
let config = {
    chineseNumbers: {},      // 映射：chineseNumbers.json
    englishToChinese: {},    // 映射：englishToChinese.json
    bookMappings: {},        // 映射：bookMappings.json（中→英）
    ambiguousBooks: {}       // 映射：ambiguousBooks.json（歧义经卷）
};

// 经文数据存储（加载自TXT文件）
let scriptureData = { "和合本": {}, "环球译本": {} };

// ========== 1. 批量加载所有JSON配置文件 ==========
async function loadAllConfigs() {
    const jsonFileList = [
        { key: 'chineseNumbers', path: 'chineseNumbers.json' },
        { key: 'englishToChinese', path: 'englishToChinese.json' },
        { key: 'bookMappings', path: 'bookMappings.json' },
        { key: 'ambiguousBooks', path: 'ambiguousBooks.json' }
    ];

    try {
        for (const file of jsonFileList) {
            const response = await fetch(file.path);
            if (!response.ok) throw new Error(`${file.path} 加载失败（状态码：${response.status}）`);
            config[file.key] = await response.json();
        }
        console.log("✅ 所有配置JSON文件加载完成");
    } catch (error) {
        console.error("❌ 配置文件加载异常：", error);
        alert(`配置加载失败：${error.message}\n请检查JSON文件是否存在/格式是否正确！`);
        throw error; // 终止后续流程
    }
}

// ========== 2. 核心工具函数（仅依赖config对象） ==========
/**
 * 解析中文数字为阿拉伯数字（从chineseNumbers.json读取映射）
 * @param {string} numStr 中文数字（如：三、二十）
 * @returns {number|null} 阿拉伯数字，无匹配则返回null
 */
function parseChineseNumber(numStr) {
    for (const [_, numMap] of Object.entries(config.chineseNumbers)) {
        if (numMap[numStr]) return numMap[numStr];
    }
    return null;
}

/**
 * 解析经文位置（支持多格式：创3:1、创三:1、创3等）
 * @param {string} input 输入的经文位置
 * @returns {object|null} 解析结果：{book, chapter, startVerse, endVerse}
 */
function parseVerse(input) {
    input = input.replace(/\s/g, ''); // 移除所有空格

    // 核心匹配规则（覆盖主流格式）
    const regexRules = [
        /^([\u4e00-\u9fa5a-zA-Z]+)(\d+):(\d+)$/,                // 创3:1 / Genesis3:1
        /^([\u4e00-\u9fa5a-zA-Z]+)(\d+):(\d+)-(\d+)$/,           // 创3:1-5 / Genesis3:1-5
        /^([\u4e00-\u9fa5a-zA-Z]+)(\d+)$/,                       // 创3 / Genesis3
        /^([\u4e00-\u9fa5a-zA-Z]+)([\u4e00-\u9fa5]+):(\d+)$/     // 创三:1 / Genesis三:1
    ];

    for (const regex of regexRules) {
        const match = input.match(regex);
        if (!match) continue;

        const [, book, chapPart, versePart1, versePart2] = match;
        const chapter = isNaN(chapPart) ? parseChineseNumber(chapPart) : parseInt(chapPart);
        if (!chapter) continue;

        return {
            book,
            chapter,
            startVerse: parseInt(versePart1) || 1,
            endVerse: parseInt(versePart2) || parseInt(versePart1) || null
        };
    }
    return null;
}

/**
 * 处理歧义经卷（从ambiguousBooks.json读取）
 * @param {string} bookName 经卷名（如：约翰）
 * @returns {array} 候选经卷列表
 */
function resolveAmbiguousBook(bookName) {
    return config.ambiguousBooks[bookName] || [bookName];
}

// ========== 3. 加载并解析经文TXT文件 ==========
async function loadScriptures() {
    const txtFileList = [
        { version: '和合本', path: 'WCB20251113.txt' },
        { version: '环球译本', path: 'CUVS-NP20251113.txt' }
    ];

    try {
        for (const file of txtFileList) {
            const response = await fetch(file.path);
            if (!response.ok) throw new Error(`${file.version} 经文文件加载失败`);
            const text = await response.text();
            
            // 解析TXT格式：Genesis 1:1 起初，神创造天地。
            text.split('\n').forEach(line => {
                const lineTrim = line.trim();
                if (!lineTrim) return; // 跳过空行
                
                const match = lineTrim.match(/^([a-zA-Z0-9]+)\s+(\d+):(\d+)\s+(.*)$/);
                if (match) {
                    const [, bookEn, chap, verse, content] = match;
                    scriptureData[file.version][`${bookEn}${chap}:${verse}`] = content.trim();
                }
            });
        }
        console.log("✅ 经文TXT文件加载完成");
    } catch (error) {
        console.error("❌ 经文加载异常：", error);
        alert(`经文加载失败：${error.message}\n请检查TXT文件是否存在！`);
    }
}

// ========== 4. 页面交互核心逻辑 ==========
async function initPage() {
    // DOM元素获取（需与HTML中的id/class对应）
    const dom = {
        input: document.getElementById('verse-input'),
        searchBtn: document.getElementById('search-btn'),
        versionBtns: document.querySelectorAll('.version-btn'),
        versionName: document.getElementById('version-name'),
        resultTitle: document.getElementById('verse-title'),
        resultContent: document.getElementById('verse-content'),
        loading: document.getElementById('loading'),
        error: document.getElementById('error-message'),
        copyBtn: document.getElementById('copy-btn')
    };

    // 工具方法：显示/隐藏加载/错误/结果
    const showLoading = () => {
        dom.loading.style.display = 'block';
        dom.resultContent.parentElement.style.display = 'none';
        dom.error.parentElement.style.display = 'none';
    };
    const hideLoading = () => dom.loading.style.display = 'none';
    const showError = (msg) => {
        dom.error.textContent = msg;
        dom.error.parentElement.style.display = 'block';
        hideLoading();
    };

    // 初始化流程：先加载配置 → 再加载经文
    showLoading();
    await loadAllConfigs();
    await loadScriptures();
    hideLoading();

    // 版本切换逻辑（和合本/环球译本）
    dom.versionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            dom.versionBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            dom.versionName.textContent = btn.textContent;
        });
    });

    // 搜索核心逻辑
    const handleSearch = () => {
        const inputVal = dom.input.value.trim();
        if (!inputVal) return showError('请输入经文位置（示例：创1:1、约翰3:16）');

        // 解析经文位置
        const parsedVerse = parseVerse(inputVal);
        if (!parsedVerse) return showError('格式解析失败，请检查输入（示例：创1:1、约翰3:16）');

        // 处理歧义经卷
        const candidateBooks = resolveAmbiguousBook(parsedVerse.book);
        if (candidateBooks.length > 1) {
            return showError(`检测到歧义经卷：${candidateBooks.join(' / ')}\n请输入完整名称`);
        }

        // 中文→英文经卷名转换（从bookMappings.json读取）
        const targetBookEn = config.bookMappings[candidateBooks[0]] || candidateBooks[0];
        const targetBookCn = config.englishToChinese[targetBookEn] || candidateBooks[0];
        const currentVersion = dom.versionName.textContent;
        const verseContentList = [];

        // 读取经文内容（最多显示20节）
        const startVerse = parsedVerse.startVerse;
        const endVerse = parsedVerse.endVerse || startVerse + 19;
        for (let v = startVerse; v <= endVerse; v++) {
            const key = `${targetBookEn}${parsedVerse.chapter}:${v}`;
            if (!scriptureData[currentVersion][key]) break;
            verseContentList.push(`<span class="verse-num">${v}</span> ${scriptureData[currentVersion][key]}`);
        }

        // 无结果处理
        if (verseContentList.length === 0) {
            return showError(`未找到【${targetBookCn} ${parsedVerse.chapter}章】相关经文`);
        }

        // 显示结果
        dom.resultTitle.textContent = `${currentVersion}：${targetBookCn} ${parsedVerse.chapter}章${startVerse}-${endVerse}节`;
        dom.resultContent.innerHTML = verseContentList.join('<br>');
        dom.resultContent.parentElement.style.display = 'block';
        dom.error.parentElement.style.display = 'none';
    };

    // 绑定事件
    dom.searchBtn.addEventListener('click', handleSearch);
    dom.input.addEventListener('keypress', (e) => e.key === 'Enter' && handleSearch());
    
    // 复制功能
    if (dom.copyBtn) {
        dom.copyBtn.addEventListener('click', () => {
            const copyText = `${dom.resultTitle.textContent}\n${dom.resultContent.textContent}`;
            navigator.clipboard.writeText(copyText)
                .then(() => alert('经文复制成功！'))
                .catch(() => alert('复制失败，请手动复制'));
        });
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', initPage);
