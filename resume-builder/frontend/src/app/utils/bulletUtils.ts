import React from 'react';

/**
 * Handles KeyDown events on textareas (e.g. Experience description)
 * to automatically move to the next line and add a bullet on Enter key press.
 * Also handles exit from bulleted list on empty bullet lines.
 */
export const handleBulletKeyDown = (
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  currentText: string,
  onUpdate: (newText: string) => void
) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    const target = e.currentTarget;
    const { selectionStart, selectionEnd } = target;

    const value = currentText || '';
    const beforeText = value.substring(0, selectionStart);
    const afterText = value.substring(selectionEnd);

    const lastNewlineIndex = beforeText.lastIndexOf('\n');
    const currentLine = beforeText.substring(lastNewlineIndex + 1);
    const trimmedLine = currentLine.trim();

    // Case 1: Empty bullet line (only bullet symbol like '•', '-', '*' with optional space)
    // Pressing Enter on an empty bullet line erases the bullet to exit list mode cleanly.
    if (trimmedLine === '•' || trimmedLine === '-' || trimmedLine === '*') {
      const lineStartPos = lastNewlineIndex + 1;
      const newText = value.substring(0, lineStartPos) + afterText;
      onUpdate(newText);

      setTimeout(() => {
        target.selectionStart = target.selectionEnd = lineStartPos;
      }, 0);
      return;
    }

    // Case 2: Match existing bullet or numbered pattern
    const bulletMatch = currentLine.match(/^(\s*)([•\-\*])\s*/);
    const numberMatch = currentLine.match(/^(\s*)(\d+)\.\s*/);

    let updatedBefore = beforeText;
    let bulletPrefix = '• ';

    if (bulletMatch) {
      bulletPrefix = `${bulletMatch[1]}${bulletMatch[2]} `;
    } else if (numberMatch) {
      const nextNum = parseInt(numberMatch[2], 10) + 1;
      bulletPrefix = `${numberMatch[1]}${nextNum}. `;
    } else {
      // Case 3: Line does not have a bullet prefix yet.
      // Prepend bullet prefix to the current line if it has content
      const lineStartPos = lastNewlineIndex + 1;
      const lineContent = beforeText.substring(lineStartPos);
      if (lineContent.length > 0) {
        updatedBefore = beforeText.substring(0, lineStartPos) + '• ' + lineContent;
      }
      bulletPrefix = '• ';
    }

    const insertion = '\n' + bulletPrefix;
    const newText = updatedBefore + insertion + afterText;
    const newCursorPos = updatedBefore.length + insertion.length;

    onUpdate(newText);

    setTimeout(() => {
      target.selectionStart = target.selectionEnd = newCursorPos;
    }, 0);
  }
};
