// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import cronParser from 'cron-parser';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	const register = vscode.commands.registerTextEditorCommand;

	class Result<T> {
		private success: boolean;
		private data: T;
		private error: any;

		constructor(_success: boolean, _data: T, _error: any) {
			this.success = _success;
			this.data = _data;
			this.error = _error;
		}

		isOk(): boolean {
			return this.success;
		}

		wrap(): T {
			return this.data;
		}

		err(): any {
			return this.error;
		}

		static succ<T>(_data: T): Result<T> {
			return new Result(true, _data, undefined);
		}

		static fail<T>(_data: T): Result<T> {
			return new Result(false, _data, undefined);
		}

		static err(_error: any): Result<any> {
			return new Result(false, undefined, _error);
		}

	}

	enum ConvertType {
		UNKNOWN,
		TIME,
		UNICODE,
		// *    *    *    *    *    *
		// ┬    ┬    ┬    ┬    ┬    ┬
		// │    │    │    │    │    |
		// │    │    │    │    │    └ day of week (0 - 7, 1L - 7L) (0 or 7 is Sun)
		// │    │    │    │    └───── month (1 - 12)
		// │    │    │    └────────── day of month (1 - 31, L)
		// │    │    └─────────────── hour (0 - 23)
		// │    └──────────────────── minute (0 - 59)
		// └───────────────────────── second (0 - 59, optional)
		CRONTAB,
		BASE64,
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
	// console.warn('"preview-conversion" active!');

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
				const conversionResult = convertTime(_substring);
				if (conversionResult.isOk()) {
					const dataOutput = new Date(Number(conversionResult.wrap().timestamp.toString()));
					return formatDateByLocale(dataOutput);
				} else {
					return _substring;
				}
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

			// console.log('provideHover: ', result);

			if (ConvertType.UNKNOWN === result.convertType) {
				return undefined;
			}

			let providerResult: vscode.ProviderResult<vscode.Hover>;

			switch (result.convertType) {
				case ConvertType.TIME:
					providerResult = handleTime(hoveredWord[result.index]);
					break;
				case ConvertType.UNICODE:
					providerResult = handleUnicode(hoveredWord[result.index]);
					break;
				case ConvertType.CRONTAB:
					providerResult = handleCronTab(hoveredWord[result.index]);
					break;
				case ConvertType.BASE64:
					providerResult = handleBase64(hoveredWord[result.index]);
					break;
			}

			// console.log('type:', typeof providerResult);

			function isHover(r: any): r is vscode.Hover {
				return (<vscode.Hover>r)?.contents !== undefined;
			}

			if (isHover(providerResult)) {
				providerResult.contents = [
					...providerResult.contents,
					// new vscode.MarkdownString('&#10084;', true)
				];
			}

			console.log('providerResult:', providerResult);

			return providerResult;
		}
	});

	interface TimeData {
		cleanTime: any,
		timestamp: string,
		unitType: TimeUnitType,
		isHex: boolean,
		isFull: boolean,
		convertMillisecondsNotice: boolean,
		preGregorianCalendarNotice: boolean,
	}

	function convertTime(source: any): Result<TimeData> {
		// console.log('convertTime:', data);

		const cleanTime = cleanTimestamp(source);

		let data = {
			cleanTime,
			timestamp: '',
			unitType: TimeUnitType.SECOND,
			isHex: false,
			isFull: false,
			convertMillisecondsNotice: false,
			preGregorianCalendarNotice: false,
		};

		if (cleanTime && cleanTime !== source.trim()) {
			data.isFull = false;
		}

		if ((cleanTime.length === 0) || isNaN(cleanTime)) {
			if (!isHex(cleanTime)) {
				return Result.fail(data);
			} else {
				data.isHex = true;
			}
		}

		let _data = cleanTime * 1;
		if ((_data >= 1E16) || (_data <= -1E16)) {
			data.unitType = TimeUnitType.NANOSECONDS;
			_data = Math.floor(_data / 1000000);
		} else if ((_data >= 1E14) || (_data <= -1E14)) {
			data.unitType = TimeUnitType.MICROSECONDS;
			_data = Math.floor(_data / 1000);
		} else if ((_data >= 1E11) || (_data <= -3E10)) {
			data.unitType = TimeUnitType.MILLISECONDS;
		} else {
			data.unitType = TimeUnitType.SECOND;
			if ((_data > 1E11) || (_data < -1E10)) {
				data.convertMillisecondsNotice = true;
			}
			_data = (_data * 1000);
		}
		if (_data < -68572224E5) {
			data.preGregorianCalendarNotice = true;
		}

		data.timestamp = _data.toString();

		return Result.succ(data);
	}

	function handleTime(hoveredWord: string): vscode.ProviderResult<vscode.Hover> {
		let markdownArray: Array<vscode.MarkdownString> = [
			new vscode.MarkdownString('**Conversion Timestamp**', true)
		];

		const conversionResult = convertTime(hoveredWord);

		if (conversionResult.isOk()) {
			let data = conversionResult.wrap();
			if (!data.isFull) {
				markdownArray.push(new vscode.MarkdownString(`Converting ${data.cleanTime} :`));
			}
			if (data.isHex) {
				markdownArray.push(new vscode.MarkdownString(`Converting 0x${data.cleanTime} :`));
			}
			markdownArray.push(new vscode.MarkdownString(`检测到时间单位为${getTimeUnitTypeName(data.unitType)}:`));
			markdownArray.push(new vscode.MarkdownString('----'));

			if (data.convertMillisecondsNotice) {
				markdownArray.push(new vscode.MarkdownString('如果您尝试转换毫秒，请删除最后 3 位数字。'));
			}
			const dataOutput = new Date(Number(data.timestamp.toString()));
			const gmt = new Date(Number(data.timestamp.toString())).toUTCString();
			markdownArray.push(new vscode.MarkdownString('**GMT(标准时间)**'));
			markdownArray.push(new vscode.MarkdownString(gmt));
			markdownArray.push(new vscode.MarkdownString('**Your time zone(当前时区)**'));
			markdownArray.push(new vscode.MarkdownString(dataOutput.toString()));
			markdownArray.push(new vscode.MarkdownString(formatDateByLocale(dataOutput)));
			if (data.preGregorianCalendarNotice) {
				markdownArray.push(new vscode.MarkdownString('1752 年 9 月 14 日（公历之前）之前的日期不准确。'));
			}
		}

		return {
			contents: markdownArray
		};
	}

	interface CronTabData {
		timeList: string[]
	}

	function convertCronTab(hoveredWord: string): Result<CronTabData> {
		/**
		 * yyyy-MM-dd HH:mm:ss
		 */
		function formatDate(date: Date, withWeek: boolean = true): string {
			let days = [
				date.getFullYear(),
				String(date.getMonth() + 1).padStart(2, '0'),
				String(date.getDate()).padStart(2, '0'),
			].join('-');
			let times = [
				String(date.getHours()).padStart(2, '0'),
				String(date.getMinutes()).padStart(2, '0'),
				String(date.getSeconds()).padStart(2, '0'),
			].join(':');

			let result = [days];
			if (withWeek) {
				const weekdays = ['星期天', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
				result.push(weekdays[date.getDay()]);
			}
			result.push(times);

			return result.join(' ');
		}

		let data: CronTabData = {
			timeList: [],
		};

		let options: cronParser.ParserOptions = {
			currentDate: formatDate(new Date(), false),
			tz: 'Asia/Shanghai',
		};

		try {
			let interval = cronParser.parseExpression(hoveredWord, options);

			for (let i = 0; i < 10; i++) {
				data.timeList.push(formatDate(interval.next().toDate()));
			}
		} catch (err) {
			return Result.err(err);
		}
		return Result.succ(data);
	}

	function handleCronTab(hoveredWord: string): vscode.ProviderResult<vscode.Hover> {
		let markdownArray: Array<vscode.MarkdownString> = [
			new vscode.MarkdownString('**Conversion CronTab**', true),
		];

		let convertResult = convertCronTab(hoveredWord);

		// console.log('handleCronTab:', convertResult);

		if (convertResult.isOk()) {
			markdownArray.push(new vscode.MarkdownString(`Converting ${hoveredWord}`));
			markdownArray.push(new vscode.MarkdownString('----'));

			const data = convertResult.wrap();

			let text = new vscode.MarkdownString();
			text.appendMarkdown(`**近${data.timeList.length}次执行时间**\n`);
			text.appendMarkdown('|序号|执行时间|\n');
			text.appendMarkdown('|--|--|\n');
			data.timeList.forEach((it, index) => {
				text.appendMarkdown(`|${index + 1}|${it}|\n`);
			});
			markdownArray.push(text);
		}
		return {
			contents: markdownArray
		};
	}

	class DataBase64 {
		head: string;
		private code: string = '';
		private buff: Buffer | undefined = undefined;

		constructor(_head: string = '', _code: string = '') {
			this.head = _head;
			this.changeCode(_code);
		}

		codeDesc(): string {
			if (this.code.length > 100) {
				return `${this.code.substring(0, 30)}...${this.code.substring(this.code.length - 30, this.code.length)}`;
			} else {
				return this.code;
			}
		}

		changeCode(_data: string) {
			this.code = _data.replace(/((data:\S*;)?base64,)?/g, '');
			this.buff = Buffer.from(this.code, 'base64');
		}

		isBase64(): boolean {
			// Base64 字符串的正则表达式
			const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/g;

			// 先检查字符串长度是否为4的倍数
			if (!this.code || this.code.length % 4 !== 0) {
				return false;
			}

			// 检查字符串是否符合 Base64 字符集规则
			return base64Regex.test(this.code);
		}

		isImage(): boolean {
			return typeof this.head === 'string' && this.head.includes('data:image');
		}

		toImage(): string | undefined {
			if (!this.isImage()) {
				return;
			}
			return `${this.head}${this.code}`;
		}

		isXML(): boolean {
			const decoded = this.decode();
			if (decoded) {
				if (/(>)(<)(\/*)/g.test(decoded)) {
					return true;
				}
			}
			return false;
		}

		toXML(): any {
			if (!this.isXML()) {
				return;
			}

			const xmlString = this.decode();
			if (!xmlString) {
				return;
			}

			try {
				// 将字符串解析为 XML DOM 对象
				const parser = new DOMParser();
				const xmlDoc = parser.parseFromString(xmlString, "text/xml");

				// 将 XML DOM 对象序列化为字符串
				const serializer = new XMLSerializer();
				const xmlSerialized = serializer.serializeToString(xmlDoc);

				// 使用正则表达式缩进格式化
				const formatted = xmlSerialized
					.replace(/(>)(<)(\/*)/g, '$1\r\n$2$3') // 在两个标记之间添加换行符
					.replace(/(<\w+)(.*?>)/g, function (match, nodeName, nodeProps) {
						// 缩进层次
						let indent = match?.match(/<\/?[\w:\-]+>/g)?.length ?? 1;
						return ' '.repeat(indent * 2) + nodeName + nodeProps;
					});
				return formatted;
			} catch (error) {
				return error;
			}
		}

		decode(): string | undefined {
			return this.buff?.toString();
		}

	}

	function convertBase64(hoveredWord: string): Result<DataBase64> {
		const base64Regex = /((data:image\/svg\+xml;)?base64,)?(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
		let data = new DataBase64();
		hoveredWord.replace(base64Regex, function (_substring, _head): string {
			// console.log('convertBase64:', _head, ' ---- ', _substring);
			data.head = _head;
			data.changeCode(_substring);
			return '';
		});
		// console.log('convertBase64 result:', result);
		return Result.succ(data);
	}

	function handleBase64(hoveredWord: string): vscode.ProviderResult<vscode.Hover> {
		let markdownArray: Array<vscode.MarkdownString> = [
			new vscode.MarkdownString('**Conversion Base64**', true)
		];

		const convertResult = convertBase64(hoveredWord);

		// console.log('handleBase64:', convertResult);

		if (!convertResult.isOk()) {
			return;
		}

		const data = convertResult.wrap();

		if (!data.isBase64()) {
			// console.error('handleBase64: not Base64!');
			return;
		}

		markdownArray.push(new vscode.MarkdownString(`Converting ${data.codeDesc()}`));
		markdownArray.push(new vscode.MarkdownString('----'));

		let text = new vscode.MarkdownString();
		text.isTrusted = true;
		text.supportHtml = true;
		if (data.isImage()) {
			markdownArray.push(new vscode.MarkdownString('_IMAGE TYPE_'));
			text.appendMarkdown(`_${data.head}_`);
			text.appendMarkdown(`<br><img src="${data.toImage()}"/>`);
		} else if (data.isXML()) {
			markdownArray.push(new vscode.MarkdownString('_XML TYPE_'));
			const xmlResult = data.toXML();
			if (xmlResult && xmlResult.length) {
				text.appendCodeblock(xmlResult, 'xml');
			} else {
				// text.appendCodeblock( ?? '', 'xml');
				text.appendText(xmlResult?.toString() ?? '');
			}
		} else {
			markdownArray.push(new vscode.MarkdownString('_UNKNOWN TYPE_'));
			text.appendCodeblock(data.decode() ?? '');
		}

		markdownArray.push(text);

		let result: vscode.ProviderResult<vscode.Hover> = {
			contents: markdownArray
		};
		return result;
	}

	function convertUnicode(hoveredWord: string): string {
		const unicodeRegex = /\\U([\da-fA-F]{8})|[\\]?U\+([\da-fA-F]{5})|[\\]?U\+([\da-fA-F]{4})|\\u([\da-fA-F]{4})/g;

		return hoveredWord.replace(unicodeRegex, (match, u8p, u5p, u4p, u4) => {
			// console.log('convertUnicode:', match, u8p, u5p, u4p, u4);
			if (u4) {
				return String.fromCharCode(parseInt(u4, 16));
			} else if (u4p) {
				return String.fromCharCode(parseInt(u4p, 16));
			} else if (u5p) {
				return String.fromCodePoint(parseInt(u5p, 16));
			} else if (u8p) {
				return String.fromCodePoint(parseInt(u8p, 16));
			}
			return match;
		});
	}

	function handleUnicode(hoveredWord: string): vscode.ProviderResult<vscode.Hover> {
		let markdownArray: Array<vscode.MarkdownString> = [
			new vscode.MarkdownString('**Conversion Unicode**', true)
		];

		let convertedText = convertUnicode(hoveredWord);

		function unicodeDesc(): string {
			if (hoveredWord.length > 100) {
				return `${hoveredWord.substring(0, 30)}...${hoveredWord.substring(hoveredWord.length - 30, hoveredWord.length)}`;
			} else {
				return hoveredWord;
			}
		}

		markdownArray.push(new vscode.MarkdownString(`Converting ${unicodeDesc()}`));
		markdownArray.push(new vscode.MarkdownString('----'));

		let text = new vscode.MarkdownString();
		let firstIndex = convertedText.indexOf('{');
		let lastIndex = convertedText.lastIndexOf('}');

		if (firstIndex !== -1 && lastIndex !== -1) {
			markdownArray[0] = new vscode.MarkdownString('**Conversion Unicode + JSON**', true);
			const json = JSON.parse(convertedText.substring(firstIndex, lastIndex + 1));

			text.appendMarkdown(convertedText.substring(0, firstIndex));
			text.appendCodeblock(JSON.stringify(json, null, 2), 'json');
			text.appendMarkdown(convertedText.substring(lastIndex + 1, convertedText.length));
		} else {
			text.appendText(convertedText);
		}

		markdownArray.push(text);

		let result: vscode.ProviderResult<vscode.Hover> = {
			contents: markdownArray
		};
		return result;
	}

	interface CheckConvertTypeData {
		convertType: ConvertType,
		index: number
	}

	function checkConvertTypeForMultiSource(sources: Array<string>): CheckConvertTypeData {
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
		function checkTime(): boolean {
			const timeRegex = /^-?[0-9]+$/g;
			return timeRegex.test(hoveredWord);
		}

		function checkBase64(): boolean {
			const base64Regex = /(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/g;

			if (!base64Regex.test(hoveredWord)) {
				return false;
			}

			let splitArr = hoveredWord.split(',');
			let text = hoveredWord;
			if (splitArr.length >= 2) {
				text = splitArr[1];
			}

			if (text.length % 4 !== 0) {
				return false;
			}

			return true;
		}

		function checkCronTab(): boolean {
			try {
				cronParser.parseExpression(hoveredWord);
				return true;
			} catch (error) {
			}
			return false;
		}

		function checkUniCode(): boolean {
			const unicodeRegex = /\\U([\da-fA-F]{8})|[\\]?U\+([\da-fA-F]{4,5})|\\u([\da-fA-F]{4})/g;

			let result = hoveredWord.match(unicodeRegex);
			// console.log('checkUniCode:', result);
			return result?.some(it => {
				return it.length > 0;
			}) ?? false;
		}

		if (checkTime()) {
			return ConvertType.TIME;
		} else if (checkUniCode()) {
			return ConvertType.UNICODE;
		} else if (checkCronTab()) {
			return ConvertType.CRONTAB;
		} else if (checkBase64()) {
			return ConvertType.BASE64;
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
	// console.warn('"preview-conversion" deactivate!');
}
