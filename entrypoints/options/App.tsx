import React, { useState } from "react";
import { detectLocale, messages } from "../../src/lib/locales";
import type { SupportedLocale } from "../../src/lib/types";
import { SettingsView } from "../sidepanel/components/SettingsView";
import { UpdateNotice } from "../shared/UpdateNotice";

export const App: React.FC = () => {
	const [locale] = useState<SupportedLocale>(detectLocale());
	const t = messages[locale];

	return (
		<div className="popup-container" style={{ maxWidth: 540, margin: "24px auto" }}>
			<header className="popup-header">
				<div className="popup-header__brand">
					<h1 className="popup-header__title popup-header__title--text">
						{t.title}
					</h1>
				</div>
			</header>
			<UpdateNotice t={t} />

			<main className="popup-main">
				<SettingsView
					locale={locale}
					t={t}
					onBack={() => {
						if (window.history.length > 1) {
							window.history.back();
						} else {
							window.close();
						}
					}}
				/>
			</main>
		</div>
	);
};
