// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	const register = vscode.commands.registerTextEditorCommand;

	enum ConvertType {
		UNKNOWN,
		TIME,
		UNICODE,
	}

	enum TimeUnitType {
		NANOSECONDS,  // 纳秒（十亿分之一秒）
		MICROSECONDS,	// 微秒（百万分之一秒）
		MILLISECONDS,	// 毫秒（千分之一秒）
		SECOND,				// 秒
	}

	function getTimeUnitTypeName(type: TimeUnitType): string {
		switch (type) {
			case TimeUnitType.NANOSECONDS:
				return '纳秒（十亿分之一秒）';
			case TimeUnitType.MICROSECONDS:
				return '微秒（百万分之一秒）';
			case TimeUnitType.MILLISECONDS:
				return '毫秒（千分之一秒）';
			default:
				return '秒';
		}
	}

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.warn('"preview-conversion" active!');

	const tokens = [
		// vscode.commands.registerCommand('preview-conversion.conversion', () => {
		// 	// The code you place here will be executed every time your command is executed
		// 	// Display a message box to the user
		// 	vscode.window.showInformationMessage('Hello VS Code!');
		// }),
		register('preview-conversion.conversion', (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) => {
			const document = textEditor.document;
			let fullText = document.getText();
			fullText = convertUnicode(fullText);
			fullText = fullText.replace(/-?\d{9}\d+/g, (_substring, _): string => {
				let conversionResult = convertTime(_substring);
				const dataOutput = new Date(Number(conversionResult.timestamp.toString()));
				return formatDateByLocale(dataOutput);
			});
			textEditor.edit((editBuilder) => {
				editBuilder.replace(new vscode.Range(0, 0, document.lineCount, 0), fullText);
			});
		}),
		register('preview-conversion.conversion(unicode)', (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) => {
			const document = textEditor.document;
			let fullText = document.getText();
			fullText = convertUnicode(fullText);
			textEditor.edit((editBuilder) => {
				editBuilder.replace(new vscode.Range(0, 0, document.lineCount, 0), fullText);
			});
		}),
	];

	context.subscriptions.push(...tokens);

	let sel: vscode.DocumentSelector = { scheme: '*', language: '*' };

	vscode.languages.registerHoverProvider(sel, {
		provideHover(document, position, token): vscode.ProviderResult<vscode.Hover> {
			let range = document.getWordRangeAtPosition(position);
			let hoveredWord = [
				range ? document.getText(range) : '',
				document.lineAt(position.line).text,
			].sort(function (a, b): number {
				if (a.length === b.length) {
					return 0;
				} else if (a.length > b.length) {
					return 1;
				} else {
					return -1;
				}
			});

			// console.log('hoveredWord: ', range, '   ', hoveredWord);

			const result = checkConvertTypeForMultiSource(hoveredWord);
			if (ConvertType.UNKNOWN === result.convertType) {
				return undefined;
			}
			switch (result.convertType) {
				case ConvertType.TIME:
					return handleTime(hoveredWord[result.index]);
				case ConvertType.UNICODE:
					return handleUnicode(hoveredWord[result.index]);
			}
		}
	});

	function convertTime(data: any): { cleanTime: any, timestamp: string, unitType: TimeUnitType, isHex: boolean, isFull: boolean, convertMillisecondsNotice: boolean, preGregorianCalendarNotice: boolean } {
		console.log('convertTime:', data);

		const cleanTime = cleanTimestamp(data);

		let result = {
			cleanTime,
			timestamp: '',
			unitType: TimeUnitType.SECOND,
			isHex: false,
			isFull: false,
			convertMillisecondsNotice: false,
			preGregorianCalendarNotice: false,
		};

		if (cleanTime && cleanTime !== data.trim()) {
			result.isFull = false;
		}

		if ((cleanTime.length === 0) || isNaN(cleanTime)) {
			if (!isHex(cleanTime)) {
				return result;
			} else {
				result.isHex = true;
			}
		}

		let _data = cleanTime * 1;
		if ((_data >= 1E16) || (_data <= -1E16)) {
			result.unitType = TimeUnitType.NANOSECONDS;
			_data = Math.floor(_data / 1000000);
		} else if ((_data >= 1E14) || (_data <= -1E14)) {
			result.unitType = TimeUnitType.MICROSECONDS;
			_data = Math.floor(_data / 1000);
		} else if ((_data >= 1E11) || (_data <= -3E10)) {
			result.unitType = TimeUnitType.MILLISECONDS;
		} else {
			result.unitType = TimeUnitType.SECOND;
			if ((_data > 1E11) || (_data < -1E10)) {
				result.convertMillisecondsNotice = true;
			}
			_data = (_data * 1000);
		}
		if (_data < -68572224E5) {
			result.preGregorianCalendarNotice = true;
		}

		result.timestamp = _data.toString();

		return result;
	}

	function handleTime(hoveredWord: string): vscode.ProviderResult<vscode.Hover> {
		let markdownArray: Array<vscode.MarkdownString> = [
			new vscode.MarkdownString('# Conversion Timestamp', true)
		];

		const conversionResult = convertTime(hoveredWord);

		if (conversionResult.timestamp.length === 0) {
			return;
		} else {
			if (!conversionResult.isFull) {
				markdownArray.push(new vscode.MarkdownString(`Converting ${conversionResult.cleanTime} :`));
			}
			if (conversionResult.isHex) {
				markdownArray.push(new vscode.MarkdownString(`Converting 0x${conversionResult.cleanTime} :`));
			}

			markdownArray.push(new vscode.MarkdownString(`检测到时间单位为${getTimeUnitTypeName(conversionResult.unitType)}:`));
			if (conversionResult.convertMillisecondsNotice) {
				markdownArray.push(new vscode.MarkdownString('如果您尝试转换毫秒，请删除最后 3 位数字。'));
			}
			const dataOutput = new Date(Number(conversionResult.timestamp.toString()));
			const gmt = new Date(Number(conversionResult.timestamp.toString())).toUTCString();
			markdownArray.push(new vscode.MarkdownString('**GMT(标准时间)**'));
			markdownArray.push(new vscode.MarkdownString(gmt));
			markdownArray.push(new vscode.MarkdownString('**Your time zone(当前时区)**'));
			markdownArray.push(new vscode.MarkdownString(dataOutput.toString()));
			markdownArray.push(new vscode.MarkdownString(formatDateByLocale(dataOutput)));
			if (conversionResult.preGregorianCalendarNotice) {
				markdownArray.push(new vscode.MarkdownString('1752 年 9 月 14 日（公历之前）之前的日期不准确。'));
			}
		}

		return {
			contents: markdownArray
		};
	}

	function convertUnicode(hoveredWord: string): string {
		return hoveredWord.replace(/\\u([a-fA-F0-9]{4})/g, (_, hex) =>
			String.fromCharCode(parseInt(hex, 16))
		);
	}

	function handleUnicode(hoveredWord: string): vscode.ProviderResult<vscode.Hover> {
		let markdownArray: Array<vscode.MarkdownString> = [
			new vscode.MarkdownString('# Conversion Unicode', true)
		];

		const convertedText = convertUnicode(hoveredWord);
		markdownArray.push(new vscode.MarkdownString(convertedText));

		let result: vscode.ProviderResult<vscode.Hover> = {
			contents: markdownArray
		};
		return result;
	}

	function checkConvertTypeForMultiSource(sources: Array<string>): { convertType: ConvertType, index: number } {
		let convertType: ConvertType = ConvertType.UNKNOWN;
		let index = 0;
		for (const it of sources) {
			// console.log('checkConvertTypeForMultiSource: ', it, ' ', index);
			convertType = checkConvertType(it);
			if (ConvertType.UNKNOWN !== convertType) {
				break;
			}
			index++;
		}
		return { convertType, index };
	}

	function checkConvertType(hoveredWord: string): ConvertType {
		// console.log('checkConvertType: ', hoveredWord);
		if (hoveredWord.length === 0) {
			return ConvertType.UNKNOWN;
		}
		const timeRegex = /^-?[0-9]+$/g;
		const unicodeRegex = /\\u([a-fA-F0-9]{4})/g;
		if (timeRegex.test(hoveredWord)) {
			return ConvertType.TIME;
		} else if (unicodeRegex.test(hoveredWord)) {
			return ConvertType.UNICODE;
		}
		return ConvertType.UNKNOWN;
	}

	function formatDateByLocale(time: Date, locale: string = 'zh-CN') {
		const option: Intl.DateTimeFormatOptions = {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			timeZoneName: 'short',
			hour12: false,
		};
		return time.toLocaleString(locale, option);
	}

	function cleanTimestamp(ts: any) {
		if (!ts) {
			return "";
		}
		ts = ts.replace(/[`'"\s\,]+/g, '');
		if (ts.charAt(ts.length - 1) === "L") {
			ts = ts.slice(0, -1);
		}
		return ts;
	}

	function isHex(h: any) {
		var a = parseInt(h, 16);
		return (a.toString(16) === h.toLowerCase());
	}
}

// This method is called when your extension is deactivated
export function deactivate() {
	console.warn('"preview-conversion" deactivate!');
}
