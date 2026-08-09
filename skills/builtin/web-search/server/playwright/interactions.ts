/**
 * Browser interaction helpers for text-first browser-use workflows.
 */

import { Page } from 'playwright';

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

export interface BrowserUseElement {
  ref: string;
  tag: string;
  role: string;
  type: string;
  text: string;
  placeholder: string;
  value: string;
  href: string;
  description: string;
}

export interface BrowserUseSnapshot {
  title: string;
  url: string;
  elements: BrowserUseElement[];
  text: string;
}

export interface SnapshotOptions {
  maxElements?: number;
}

function refSelector(ref: string): string {
  return `[${REF_ATTRIBUTE}="${ref.replace(/["\\]/g, '\\$&')}"]`;
}

export async function snapshotPage(
  page: Page,
  options: SnapshotOptions = {}
): Promise<BrowserUseSnapshot> {
  const maxElements = options.maxElements || 100;

  return await page.evaluate(
    ({ interactiveSelector, max, refAttribute }) => {
      const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

      const isElementVisible = (element: Element): boolean => {
        const htmlElement = element as HTMLElement;
        const style = window.getComputedStyle(htmlElement);
        const rect = htmlElement.getBoundingClientRect();
        return style.visibility !== 'hidden'
          && style.display !== 'none'
          && Number.parseFloat(style.opacity || '1') > 0
          && rect.width > 0
          && rect.height > 0;
      };

      const describeElement = (element: Element): BrowserUseElement => {
        const htmlElement = element as HTMLElement;
        const anchor = element as HTMLAnchorElement;
        const input = element as HTMLInputElement;
        const select = element as HTMLSelectElement;
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

      const elements: BrowserUseElement[] = [];
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
    },
    {
      interactiveSelector: INTERACTIVE_SELECTOR,
      max: maxElements,
      refAttribute: REF_ATTRIBUTE
    }
  );
}

export async function clickElementRef(page: Page, ref: string): Promise<void> {
  await page.locator(refSelector(ref)).first().click({ timeout: 10000 });
}

export async function fillElementRef(
  page: Page,
  ref: string,
  text: string,
  pressEnter: boolean = false
): Promise<void> {
  const locator = page.locator(refSelector(ref)).first();
  await locator.fill(text, { timeout: 10000 });
  if (pressEnter) {
    await locator.press('Enter');
  }
}

export async function selectElementRef(
  page: Page,
  ref: string,
  option: { value?: string; label?: string; index?: number }
): Promise<void> {
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

export async function pressKey(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
}
