/**
 * @file File that contains all the methods to show messages to the user.
 */

import * as vscode from 'vscode';

export enum MessageTypes {
    Error = 0,
    Warning = 1,
    Informational = 2,
}

/**
 * Summary it shows a warning or information message.
 *
 * Description showMessage shows a message to the user, it might be a warning
 * or an informational one, the method receives a text with the message
 * and a boolean for saying if it is a warning (true)
 * or an informational(false).
 *
 * @access private
 *
 * @param {String} text The text to be displayed in the message
 * @param {MessageTypes} messageType If it is a warning or an informational message
 * @return {void}
 */
export function showMessage(text: string, messageType: MessageTypes): void {
    if (messageType === 0) { // error
        vscode.window.showErrorMessage(text);
    } else if (messageType === 1) { // warning
        vscode.window.showWarningMessage(text);
    } else if (messageType === 2) { // informational
        vscode.window.showInformationMessage(text);
    }
}
