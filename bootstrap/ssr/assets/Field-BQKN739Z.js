import { useId } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
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
export { TextArea as n, TextField as r, CheckboxField as t };
