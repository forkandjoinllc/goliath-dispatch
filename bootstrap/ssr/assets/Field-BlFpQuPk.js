import { t as useI18n } from "../ssr.js";
import { useId } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/components/Form/AntiSpamFields.tsx
/**
* El campo trampa y el sello firmado, en un componente para que los tres
* formularios no puedan quedarse desincronizados del servidor.
*
* El campo trampa está oculto a la vista Y a los lectores de pantalla
* (`aria-hidden`, fuera de pantalla, sin tabulación), de modo que nadie que
* rellene el formulario lo vea nunca, mientras que un script que rellena todos
* los `input` de la página sí lo rellena.
*
* El sello lo emite el servidor al renderizar. Aquí solo se reenvía: el cliente
* no puede fabricarlo ni adelantarlo.
*/
function AntiSpamFields({ token }) {
	const { t } = useI18n();
	return /* @__PURE__ */ jsxs("div", {
		"aria-hidden": "true",
		className: "absolute left-0 top-0 size-px overflow-hidden opacity-0",
		children: [
			/* @__PURE__ */ jsx("label", {
				htmlFor: "company-url-confirm",
				children: t("marketing.forms.hpFieldLabel")
			}),
			/* @__PURE__ */ jsx("input", {
				id: "company-url-confirm",
				name: "hp_field",
				type: "text",
				tabIndex: -1,
				autoComplete: "off",
				defaultValue: ""
			}),
			/* @__PURE__ */ jsx("input", {
				type: "hidden",
				name: "form_token",
				defaultValue: token
			})
		]
	});
}
//#endregion
//#region resources/js/components/Form/Field.tsx
function Wrapper({ label, error, hint, required, htmlFor, children }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "flex flex-col gap-1.5",
		children: [
			/* @__PURE__ */ jsxs("label", {
				htmlFor,
				className: "text-sm font-medium text-carbon",
				children: [label, required ? /* @__PURE__ */ jsx("span", {
					className: "ml-1 text-safety-600",
					"aria-hidden": "true",
					children: "*"
				}) : null]
			}),
			children,
			hint && !error ? /* @__PURE__ */ jsx("p", {
				className: "text-xs text-steel-600",
				children: hint
			}) : null,
			error ? /* @__PURE__ */ jsx("p", {
				role: "alert",
				className: "text-xs font-medium text-safety-700",
				children: error
			}) : null
		]
	});
}
var INPUT_CLASS = "rounded border border-steel-300 bg-white px-3 py-2 text-sm text-carbon outline-none transition placeholder:text-steel-500 focus:border-navy-500 focus:ring-2 focus:ring-navy-200 aria-[invalid=true]:border-safety-600";
function TextField({ label, error, hint, ...props }) {
	const id = useId();
	const errorId = `${id}-error`;
	return /* @__PURE__ */ jsx(Wrapper, {
		label,
		error,
		hint,
		required: props.required,
		htmlFor: id,
		children: /* @__PURE__ */ jsx("input", {
			id,
			"aria-invalid": error ? true : void 0,
			"aria-describedby": error ? errorId : void 0,
			className: INPUT_CLASS,
			...props
		})
	});
}
function TextArea({ label, error, hint, ...props }) {
	const id = useId();
	return /* @__PURE__ */ jsx(Wrapper, {
		label,
		error,
		hint,
		required: props.required,
		htmlFor: id,
		children: /* @__PURE__ */ jsx("textarea", {
			id,
			rows: 5,
			"aria-invalid": error ? true : void 0,
			className: INPUT_CLASS,
			...props
		})
	});
}
function CheckboxField({ label, error, ...props }) {
	const id = useId();
	return /* @__PURE__ */ jsxs("div", {
		className: "flex flex-col gap-1.5",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "flex items-start gap-3",
			children: [/* @__PURE__ */ jsx("input", {
				id,
				type: "checkbox",
				"aria-invalid": error ? true : void 0,
				className: "mt-1 size-4 rounded border-steel-400 text-navy-700 focus:ring-navy-300",
				...props
			}), /* @__PURE__ */ jsx("label", {
				htmlFor: id,
				className: "text-sm text-carbon",
				children: label
			})]
		}), error ? /* @__PURE__ */ jsx("p", {
			role: "alert",
			className: "text-xs font-medium text-safety-700",
			children: error
		}) : null]
	});
}
//#endregion
export { AntiSpamFields as i, TextArea as n, TextField as r, CheckboxField as t };
