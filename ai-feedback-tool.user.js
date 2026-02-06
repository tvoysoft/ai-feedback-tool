// ==UserScript==
// @name         Рецензирование AI-чатов (deepseek)
// @namespace    http://tvoysoft.ru/
// @version      2.3.6
// @description  Инструмент для быстрой разметки и правки текста в AI-чатов
// @author
// @match        https://chat.deepseek.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=openai.com
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_deleteValue
// @run-at       document-end
// ==/UserScript==

(function() {
  'use strict';

  // ===================== КОНФИГУРАЦИЯ =====================
  const CONFIG = {
    TEXTAREA_SELECTOR: 'textarea._27c9245',
    TEXT_DUPLICATE_SELECTOR: 'div.b13855df',
    MESSAGE_CONTAINER_SELECTOR: 'div.ds-message._63c77b1',
    BUTTONS_CONTAINER_SELECTOR: 'div.ec4f5d61',
    SEND_BUTTON_SELECTOR: 'button[data-testid="send-button"], button:has(svg)',
    getPageKey: () => window.location.pathname + window.location.search,

    QUOTE_START: '❝',
    QUOTE_END: '❞',
    DELIMITER_START: '◈◇◇',
    DELIMITER_END: '◇◇◈',
    ITEM_MARKER: '◆',

  };
  CONFIG.PROMPT_PREFIX = '\n' + CONFIG.DELIMITER_START + ' МОИ ЗАМЕЧАНИЯ ' + CONFIG.DELIMITER_END + '\n\n';
  CONFIG.PROMPT_SUFFIX = '\n\n' + CONFIG.DELIMITER_START + ' УЧТИ ЭТИ ЗАМЕЧАНИЯ ' + CONFIG.DELIMITER_END;

  // Заменяемые символы в цитатах (если встречаются в тексте)
  CONFIG.REPLACE_SYMBOLS = {
    '❝': '«',  // декоративная двойная левая
    '❞': '»',  // декоративная двойная правая
  };

  const CATEGORIES = [
    {id: 'like', emoji: '👍', label: 'Нравится'},
    {id: 'dislike', emoji: '👎', label: 'Не нравится'},
    {id: 'error', emoji: '⚠️', label: 'Ошибка'},
    {id: 'add', emoji: '➕', label: 'Дополнить'},
    {id: 'rephrase', emoji: '🔄', label: 'Перефразировать'},
    {id: 'clarify', emoji: '🎯', label: 'Уточнить'},
    {id: 'delete', emoji: '❌', label: 'Удалить'},
    {id: 'expand', emoji: '🔎', label: 'Раскрыть'},
    {id: 'shorten', emoji: '📏', label: 'Сократить'},
  ];

  const STORAGE_KEY_PREFIX = 'ai_feedback_';
  const MARKER_CLASS = 'ai-feedback-marker';
  const COLLECT_FEEDBACK_BUTTON_ID = 'ai-collect-feedbacks';
  const TOGGLE_BUTTON_ID = 'ai-feedback-toggle';
  const TOGGLE_STORAGE_KEY = 'ai_feedback_disabled';

  // ===================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ =====================
  let feedbacks = [];
  let currentFeedbackData = null;
  let isInitialized = false;
  let isDisabled = true;

  // ===================== ОСНОВНАЯ ЛОГИКА =====================
  async function init() {
    if (isInitialized) return;
    isInitialized = true;

    // Загружаем состояние переключателя
    isDisabled = await GM.getValue(TOGGLE_STORAGE_KEY, true);

    loadFeedbacks();
    setupEventListeners();

    setInterval(async () => {
      const toggleButton = document.getElementById(TOGGLE_BUTTON_ID);
      if (!toggleButton) {
        createToggleButton().then(() => {
        });
      }
      const collectButton = document.getElementById(COLLECT_FEEDBACK_BUTTON_ID);
      if (!collectButton) {
        createCollectButton().then(() => {
        });
      }
    }, 500);
  }

  async function loadFeedbacks() {
    const key = STORAGE_KEY_PREFIX + CONFIG.getPageKey();
    try {
      const saved = await GM.getValue(key, []);
      feedbacks = saved || [];
      updateCollectButton();
    } catch (error) {
      feedbacks = [];
    }
  }

  async function saveFeedbacks() {
    const key = STORAGE_KEY_PREFIX + CONFIG.getPageKey();
    try {
      await GM.setValue(key, feedbacks);
    } catch (error) {
    }
  }

  // ===================== РАБОТА С ВЫДЕЛЕНИЕМ =====================
  function handleTextSelection(e) {
    if (isDisabled) return;

    if (e.target.closest('#ai-feedback-category-menu') ||
      e.target.closest('#ai-feedback-comment-menu')) {
      return;
    }

    const selection = window.getSelection();

    if (!selection || selection.isCollapsed) {
      return;
    }

    const text = selection.toString().trim();
    if (text.length === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    const startContainer = range.startContainer;

    let markerInsertElement = startContainer;
    if (markerInsertElement.nodeType === Node.TEXT_NODE) {
      markerInsertElement = markerInsertElement.parentElement;
    }

    let closestMessage = markerInsertElement.closest(CONFIG.MESSAGE_CONTAINER_SELECTOR);

    if (!closestMessage) {
      return;
    }

    currentFeedbackData = {
      text: text,
      range: range.cloneRange(),
      startContainer: startContainer,
      markerInsertElement: markerInsertElement,
      closestMessage: closestMessage,
      timestamp: Date.now(),
    };

    showCategoryMenu();
  }

  // ===================== МЕНЮ ВЫБОРА КАТЕГОРИИ =====================
  function showCategoryMenu() {
    if (!currentFeedbackData) {
      return;
    }

    const oldMenu = document.getElementById('ai-feedback-category-menu');
    if (oldMenu) oldMenu.remove();

    const menu = document.createElement('div');
    menu.id = 'ai-feedback-category-menu';
    menu.style.cssText = `
            position: fixed;
            background: white;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 16px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            z-index: 1000000;
            width: 300px;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
        `;

    const textPreview = currentFeedbackData.text.length > 60
      ? currentFeedbackData.text.substring(0, 57) + '...'
      : currentFeedbackData.text;

    // Заголовок с выделенным текстом
    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom: 12px;';
    header.innerHTML = `
            <div style="margin-bottom: 6px; color: #666; font-size: 12px;">
                Выделенный текст:
            </div>
            <div style="padding: 8px; background: #f9f9f9; border-radius: 4px; border-left: 2px solid #ffb74d; font-size: 12px; color: #444; line-height: 1.4;">
                "${textPreview}"
            </div>
            <div style="margin-top: 10px; color: #666; font-size: 12px;">
                Выберите действие (1-9):
            </div>
        `;
    menu.appendChild(header);

    // Обработчик клавиш для документа
    const keydownHandler = (e) => {
      const key = e.key;
      if (key >= '1' && key <= '9') {
        const index = parseInt(key) - 1;
        if (index < CATEGORIES.length) {
          e.preventDefault();
          e.stopPropagation();
          const category = CATEGORIES[index];
          document.removeEventListener('keydown', keydownHandler);
          menu.remove();
          cleanupMenuHandlers();
          showCommentInput(category);
        }
      }
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', keydownHandler);
        menu.remove();
        cleanupMenuHandlers();
      }
    };

    // Вешаем обработчик на весь документ
    document.addEventListener('keydown', keydownHandler);

    CATEGORIES.forEach((category, index) => {
      const button = document.createElement('button');
      const numberPrefix = index < 9 ? `<span style="color: #666; margin-right: 4px; font-size: 11px;">${index + 1}.</span>` : '';
      button.innerHTML = `${numberPrefix}${category.emoji} ${category.label}`;
      button.style.cssText = `
                display: block;
                width: 100%;
                text-align: left;
                padding: 6px 8px;
                margin: 2px 0;
                border: 1px solid #eee;
                background: #f9f9f9;
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.2s;
                font-size: 13px;
                line-height: 1.2;
            `;

      button.addEventListener('mouseenter', () => {
        button.style.background = '#e3f2fd';
        button.style.borderColor = '#2196F3';
      });

      button.addEventListener('mouseleave', () => {
        button.style.background = '#f9f9f9';
        button.style.borderColor = '#eee';
      });

      button.addEventListener('click', (e) => {
        e.stopPropagation();
        document.removeEventListener('keydown', keydownHandler);
        menu.remove();
        cleanupMenuHandlers();
        showCommentInput(category);
      });

      menu.appendChild(button);
    });

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Отмена (Esc)';
    cancelButton.style.cssText = `
            margin-top: 10px;
            width: 100%;
            padding: 6px 8px;
            background: #f5f5f5;
            color: #666;
            border: 1px solid #ddd;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
        `;

    cancelButton.addEventListener('click', (e) => {
      e.stopPropagation();
      document.removeEventListener('keydown', keydownHandler);
      menu.remove();
      cleanupMenuHandlers();
    });

    menu.appendChild(cancelButton);

    document.body.appendChild(menu);

    let closeHandler;

    function cleanupMenuHandlers() {
      if (closeHandler) document.removeEventListener('click', closeHandler);
      document.removeEventListener('keydown', keydownHandler);
    }

    closeHandler = (e) => {
      if (!menu.contains(e.target)) {
        document.removeEventListener('keydown', keydownHandler);
        menu.remove();
        cleanupMenuHandlers();
      }
    };

    setTimeout(() => {
      document.addEventListener('click', closeHandler);
    }, 100);
  }

  // ===================== ВВОД КОММЕНТАРИЯ =====================
  function showCommentInput(category) {
    if (!currentFeedbackData) {
      return;
    }

    const menu = document.createElement('div');
    menu.id = 'ai-feedback-comment-menu';
    menu.style.cssText = `
            position: fixed;
            background: white;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 16px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            z-index: 1000001;
            width: 320px;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
        `;

    const textPreview = currentFeedbackData.text.length > 60
      ? currentFeedbackData.text.substring(0, 57) + '...'
      : currentFeedbackData.text;

    menu.innerHTML = `
            <div style="margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
                <div style="font-size: 14px;">${category.emoji}</div>
                <div style="font-weight: bold; color: #333; font-size: 14px;">${category.label}</div>
            </div>
            <div style="margin-bottom: 6px; color: #666; font-size: 11px;">
                Выделенный текст:
            </div>
            <div style="margin-bottom: 12px; padding: 8px; background: #f9f9f9; border-radius: 4px; border-left: 2px solid #ffb74d; font-size: 11px; color: #444; line-height: 1.4;">
                "${textPreview}"
            </div>
            <div style="margin-bottom: 4px; color: #666; font-size: 11px;">
                Комментарий (необязательно):
            </div>
            <textarea
                id="ai-feedback-comment-input"
                placeholder="Уточните, что именно нужно изменить..."
                style="width: 100%; height: 70px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; resize: vertical; font-family: inherit; font-size: 13px; box-sizing: border-box;"
            ></textarea>
            <div style="margin-top: 12px; display: flex; justify-content: flex-end; gap: 8px;">
                <button id="ai-feedback-cancel" style="padding: 6px 12px; background: #f5f5f5; color: #666; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 12px;">
                    Отмена (Esc)
                </button>
                <button id="ai-feedback-save" style="padding: 6px 12px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
                    Сохранить (Enter)
                </button>
            </div>
        `;

    document.body.appendChild(menu);

    const textarea = document.getElementById('ai-feedback-comment-input');
    const saveButton = document.getElementById('ai-feedback-save');
    const cancelButton = document.getElementById('ai-feedback-cancel');

    // Фокус на textarea комментария
    setTimeout(() => {
      if (textarea) {
        textarea.focus();
      }
    }, 10);

    function handleCommentKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const comment = textarea.value.trim();
        saveFeedback(category, comment);
        menu.remove();
        cleanupCommentHandlers();
        return false;
      }
    }

    textarea.addEventListener('keydown', handleCommentKeydown);

    let closeHandler, escapeHandler;

    function cleanupCommentHandlers() {
      if (closeHandler) document.removeEventListener('click', closeHandler);
      if (escapeHandler) window.removeEventListener('keydown', escapeHandler);
      textarea.removeEventListener('keydown', handleCommentKeydown);
    }

    saveButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const comment = textarea.value.trim();
      saveFeedback(category, comment);
      menu.remove();
      cleanupCommentHandlers();
    });

    cancelButton.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.remove();
      cleanupCommentHandlers();
      if (currentFeedbackData) {
        showCategoryMenu();
      }
    });

    closeHandler = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        cleanupCommentHandlers();
        if (currentFeedbackData) {
          showCategoryMenu();
        }
      }
    };

    escapeHandler = (e) => {
      if (e.key === 'Escape') {
        menu.remove();
        cleanupCommentHandlers();
        if (currentFeedbackData) {
          showCategoryMenu();
        }
      }
    };

    setTimeout(() => {
      document.addEventListener('click', closeHandler);
      window.addEventListener('keydown', escapeHandler);
    }, 100);
  }

  // ===================== СОХРАНЕНИЕ ПРАВКИ =====================
  async function saveFeedback(category, comment) {
    if (!currentFeedbackData) {
      return;
    }

    const feedback = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      timestamp: currentFeedbackData.timestamp,
      text: currentFeedbackData.text,
      category: category.id,
      categoryLabel: category.label,
      categoryEmoji: category.emoji,
      comment: comment || null,
      pageKey: CONFIG.getPageKey(),
    };

    feedbacks.push(feedback);
    await saveFeedbacks();

    if (currentFeedbackData.markerInsertElement) {
      addMarker(feedback, currentFeedbackData.markerInsertElement);
    }

    updateCollectButton();

    window.getSelection().removeAllRanges();
  }

  // ===================== МАРКЕР =====================
  function addMarker(feedback, insertElement) {
    if (!insertElement || !insertElement.parentNode) {
      return;
    }

    const oldMarker = document.querySelector(`[data-feedback-id="${feedback.id}"]`);
    if (oldMarker) oldMarker.remove();

    const marker = document.createElement('span');
    marker.className = MARKER_CLASS;
    marker.dataset.feedbackId = feedback.id;
    marker.title = `${feedback.categoryLabel}${feedback.comment ? ': ' + feedback.comment : ''}`;

    marker.style.cssText = `
            display: inline-block;
            position: relative;
            width: 20px;
            height: 20px;
            background: white;
            border: 2px solid #ffb74d;
            border-radius: 50%;
            text-align: center;
            line-height: 16px;
            font-size: 12px;
            margin-right: 4px;
            vertical-align: middle;
            cursor: help;
            box-shadow: 0 1px 4px rgba(0,0,0,0.2);
            z-index: 100;
        `;

    marker.innerHTML = feedback.categoryEmoji;

    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      alert(`${feedback.categoryLabel}\nТекст: "${feedback.text}"\n${feedback.comment ? 'Комментарий: ' + feedback.comment : ''}`);
    });

    try {
      insertElement.parentNode.insertBefore(marker, insertElement);
    } catch (error) {
    }
  }

  // ===================== КНОПКА ПЕРЕКЛЮЧАТЕЛЬ =====================
  function updateButton(toggleButton) {
    toggleButton.innerHTML = isDisabled ? '📄' : '📝';
    toggleButton.style.background = isDisabled ? '#f5f5f5' : '#ebffee';
    toggleButton.style.color = isDisabled ? '#666' : '#2fd32f';
    toggleButton.style.borderColor = isDisabled ? '#ddd' : '#cdffd2';
    toggleButton.title = isDisabled ? 'Включить правку текста' : 'Выключить правку текста';
  }

  async function createToggleButton() {
    const buttonsContainer = document.querySelector(CONFIG.BUTTONS_CONTAINER_SELECTOR);
    if (!buttonsContainer) {
      return;
    }

    const oldToggle = document.getElementById(TOGGLE_BUTTON_ID);
    if (oldToggle) oldToggle.remove();

    const toggleButton = document.createElement('button');
    toggleButton.id = TOGGLE_BUTTON_ID;
    updateButton(toggleButton);

    toggleButton.style.cssText = `
            display: inline-block;
            background: ${isDisabled ? '#f5f5f5' : '#ebffee'};
            color: ${isDisabled ? '#666' : '#2fd32f'};
            border: 1px solid ${isDisabled ? '#ddd' : '#cdffd2'};
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            margin-left: 8px;
            vertical-align: middle;
            transition: all 0.2s;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        `;

    toggleButton.addEventListener('mouseenter', () => {
      toggleButton.style.opacity = '0.8';
    });

    toggleButton.addEventListener('mouseleave', () => {
      toggleButton.style.opacity = '1';
    });

    toggleButton.addEventListener('click', async () => {
      isDisabled = !isDisabled;
      updateButton(toggleButton);

      await GM.setValue(TOGGLE_STORAGE_KEY, isDisabled);
    });

    buttonsContainer.appendChild(toggleButton);
  }

  // ===================== КНОПКА "ВСТАВИТЬ ПРАВКИ" =====================
  function createCollectButton() {
    const buttonsContainer = document.querySelector(CONFIG.BUTTONS_CONTAINER_SELECTOR);
    if (!buttonsContainer) {
      return
    }

    const oldButton = document.getElementById(COLLECT_FEEDBACK_BUTTON_ID);
    if (oldButton) oldButton.remove();

    const collectButton = document.createElement('button');
    collectButton.innerHTML = 'Вставить правки (0)';
    collectButton.id = COLLECT_FEEDBACK_BUTTON_ID;
    collectButton.type = 'button';

    collectButton.style.cssText = `
            display: inline-block;
            background: #4CAF50;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.2);
            transition: all 0.2s;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            margin-left: 8px;
            vertical-align: middle;
        `;

    collectButton.addEventListener('mouseenter', () => {
      collectButton.style.background = '#45a049';
      collectButton.style.transform = 'translateY(-1px)';
    });

    collectButton.addEventListener('mouseleave', () => {
      collectButton.style.background = '#4CAF50';
      collectButton.style.transform = 'translateY(0)';
    });

    collectButton.addEventListener('click', () => {
      generatePrompt();
    });

    buttonsContainer.appendChild(collectButton);

    updateCollectButton();
  }

  function updateCollectButton() {
    const collectButton = document.getElementById('ai-collect-feedbacks');
    if (collectButton) {
      collectButton.textContent = `Вставить правки (${feedbacks.length})`;
      collectButton.style.display = feedbacks.length > 0 ? 'inline-block' : 'none';
    }
  }

  // ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====================
  function sanitizeQuote(text) {
    if (!text) return '';

    let sanitized = text;

    // Заменяем проблемные кавычки на стандартные
    Object.keys(CONFIG.REPLACE_SYMBOLS).forEach(symbol => {
      sanitized = sanitized.split(symbol).join(CONFIG.REPLACE_SYMBOLS[symbol]);
    });

    return sanitized;
  }

  function wrapQuote(text) {
    const sanitized = sanitizeQuote(text);
    return CONFIG.QUOTE_START + sanitized + CONFIG.QUOTE_END;
  }

// ===================== ГЕНЕРАЦИЯ ПРОМПТА =====================
  function generatePrompt() {
    if (feedbacks.length === 0) {
      return;
    }

    let prompt = CONFIG.PROMPT_PREFIX;

    feedbacks.forEach((feedback, index) => {
      if (!feedback.text || feedback.text.trim() === '') {
        return;
      }

      const quote = wrapQuote(feedback.text);

      prompt += `${feedback.categoryEmoji} ЗАМЕЧАНИЕ ${index + 1}:\n`;
      prompt += `  Цитата: ${quote}\n`;
      prompt += `  Тип: ${feedback.categoryLabel}`;

      if (feedback.comment && feedback.comment.trim() !== '') {
        prompt += `\n  Комментарий: ${feedback.comment}`;
      }

      prompt += '\n\n';
    });

    prompt += CONFIG.PROMPT_SUFFIX;

    // Вставляем текст и активируем кнопку отправки
    simulateRealUserInput(prompt);

    // Очищаем правки
    clearFeedbacks();
  }


  function simulateRealUserInput(text) {
    const textarea = document.querySelector(CONFIG.TEXTAREA_SELECTOR);

    if (!textarea) return;

    text = (textarea.value ? textarea.value + '\n' : '') + text;

    textarea.focus();

    // 1. Сначала диспатчим события composition (для IME)
    textarea.dispatchEvent(new CompositionEvent('compositionstart', {data: text}));
    textarea.dispatchEvent(new CompositionEvent('compositionupdate', {data: text}));
    textarea.dispatchEvent(new CompositionEvent('compositionend', {data: text}));

    // 2. Устанавливаем значение через нативный setter
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    ).set;

    valueSetter.call(textarea, text);

    // 3. Диспатчим все возможные события
    const events = [
      'keydown', 'keypress', 'keyup',
      'input', 'change', 'blur', 'focus'
    ];

    events.forEach(eventType => {
      const event = new Event(eventType, {
        bubbles: true,
        cancelable: true
      });

      // Добавляем свойства для KeyboardEvent
      if (eventType.includes('key')) {
        Object.defineProperties(event, {
          key: {value: ' '},
          code: {value: 'Space'},
          keyCode: {value: 32}
        });
      }

      textarea.dispatchEvent(event);
    });

    // // 4. Пытаемся найти и активировать кнопку отправки
    // setTimeout(() => {
    //   // Ищем кнопку отправки
    //   const sendButton = document.querySelector('button[data-testid*="send"]') ||
    //     document.querySelector('button:has(svg)') ||
    //     document.querySelector('button[class*="send"]');
    //
    //   if (sendButton && !sendButton.disabled) {
    //     sendButton.click();
    //   }
    //
    //   // Или пробуем нажать Enter
    //   textarea.dispatchEvent(new KeyboardEvent('keydown', {
    //     key: 'Enter',
    //     code: 'Enter',
    //     keyCode: 13,
    //     bubbles: true
    //   }));
    // }, 100);
  }


  async function clearFeedbacks() {
    currentFeedbackData = null;

    document.querySelectorAll(`.${MARKER_CLASS}`).forEach(marker => {
      marker.remove();
    });

    feedbacks = [];
    await saveFeedbacks();
    updateCollectButton();

    const key = STORAGE_KEY_PREFIX + CONFIG.getPageKey();
    try {
      await GM_deleteValue(key);
    } catch (error) {
    }
  }

  // ===================== СЛУШАТЕЛИ СОБЫТИЙ =====================
  function setupEventListeners() {
    document.addEventListener('mouseup', handleTextSelection);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const categoryMenu = document.getElementById('ai-feedback-category-menu');
        const commentMenu = document.getElementById('ai-feedback-comment-menu');

        if (categoryMenu) categoryMenu.remove();
        if (commentMenu) commentMenu.remove();
      }
    });
  }

  // ===================== ЗАПУСК =====================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(init, 1000);
    });
  } else {
    setTimeout(init, 1000);
  }

})();
