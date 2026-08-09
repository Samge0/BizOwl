"use strict";
/**
 * Browser interaction helpers for text-first browser-use workflows.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshotPage = snapshotPage;
exports.clickElementRef = clickElementRef;
exports.fillElementRef = fillElementRef;
exports.selectElementRef = selectElementRef;
exports.pressKey = pressKey;
const REF_ATTRIBUTE = 'data-qcc-browser-ref';
const INTERACTIVE_SELECTOR = [
    'a[href]',
    'button',
    'input',
    'textarea',
    'select',
    'summary',
    '[role="button"]',
    '[role="link"]',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])'
].join(',');
function refSelector(ref) {
    return `[${REF_ATTRIBUTE}="${ref.replace(/["\\]/g, '\\$&')}"]`;
}
async function snapshotPage(page, options = {}) {
    const maxElements = options.maxElements || 100;
    return await page.evaluate(({ interactiveSelector, max, refAttribute }) => {
        const normalizeText = (value) => value.replace(/\s+/g, ' ').trim();
        const isElementVisible = (element) => {
            const htmlElement = element;
            const style = window.getComputedStyle(htmlElement);
            const rect = htmlElement.getBoundingClientRect();
            return style.visibility !== 'hidden'
                && style.display !== 'none'
                && Number.parseFloat(style.opacity || '1') > 0
                && rect.width > 0
                && rect.height > 0;
        };
        const describeElement = (element) => {
            const htmlElement = element;
            const anchor = element;
            const input = element;
            const select = element;
            const tag = element.tagName.toLowerCase();
            const role = element.getAttribute('role') || '';
            const type = input.type || '';
            const text = normalizeText(element.textContent || '');
            const placeholder = input.placeholder || '';
            const value = tag === 'select'
                ? normalizeText(select.selectedOptions?.[0]?.textContent || select.value || '')
                : input.value || '';
            const href = anchor.href || '';
            const label = element.getAttribute('aria-label')
                || element.getAttribute('title')
                || placeholder
                || text
                || value
                || href;
            const parts = [
                tag,
                type ? `type="${type}"` : '',
                role ? `role="${role}"` : '',
                placeholder ? `placeholder="${placeholder}"` : '',
                href ? `href="${href}"` : '',
                label ? `| ${normalizeText(label).slice(0, 120)}` : ''
            ].filter(Boolean);
            return {
                ref: '',
                tag,
                role,
                type,
                text: text.slice(0, 500),
                placeholder,
                value: value.slice(0, 500),
                href,
                description: parts.join(' ')
            };
        };
        document.querySelectorAll(`[${refAttribute}]`).forEach((element) => {
            element.removeAttribute(refAttribute);
        });
        const elements = [];
        const candidates = Array.from(document.querySelectorAll(interactiveSelector));
        for (const candidate of candidates) {
            if (elements.length >= max) {
                break;
            }
            if (!isElementVisible(candidate)) {
                continue;
            }
            const disabled = candidate.hasAttribute('disabled')
                || candidate.getAttribute('aria-disabled') === 'true';
            if (disabled) {
                continue;
            }
            const element = describeElement(candidate);
            element.ref = `e${elements.length + 1}`;
            candidate.setAttribute(refAttribute, element.ref);
            elements.push(element);
        }
        return {
            title: document.title || '',
            url: window.location.href,
            elements,
            text: (document.body?.innerText || '').trim()
        };
    }, {
        interactiveSelector: INTERACTIVE_SELECTOR,
        max: maxElements,
        refAttribute: REF_ATTRIBUTE
    });
}
async function clickElementRef(page, ref) {
    await page.locator(refSelector(ref)).first().click({ timeout: 10000 });
}
async function fillElementRef(page, ref, text, pressEnter = false) {
    const locator = page.locator(refSelector(ref)).first();
    await locator.fill(text, { timeout: 10000 });
    if (pressEnter) {
        await locator.press('Enter');
    }
}
async function selectElementRef(page, ref, option) {
    const locator = page.locator(refSelector(ref)).first();
    if (typeof option.index === 'number') {
        await locator.selectOption({ index: option.index });
        return;
    }
    if (option.label) {
        await locator.selectOption({ label: option.label });
        return;
    }
    await locator.selectOption(option.value || '');
}
async function pressKey(page, key) {
    await page.keyboard.press(key);
}
