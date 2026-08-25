import { BrowserRouter, Routes, Route } from "react-router-dom";
import AppShell from "@/components/AppShell";
import DashboardPage from "@/features/dashboard/DashboardPage";
import SuppliersPage from "@/features/suppliers/SuppliersPage";
import NewComparisonWizard from "@/features/imports/NewComparisonWizard";
import ResultsPage from "@/features/comparisons/ResultsPage";
import ReviewQueue from "@/features/comparisons/ReviewQueue";
import HistoryPage from "@/features/comparisons/HistoryPage";
import EquivalencesPage from "@/features/equivalences/EquivalencesPage";
import SettingsPage from "@/features/settings/SettingsPage";
import CatalogPage from "@/features/catalog/CatalogPage";

export default function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/comparisons/new" element={<NewComparisonWizard />} />
          <Route path="/comparisons/:sessionId" element={<ResultsPage />} />
          <Route path="/comparisons/:sessionId/review" element={<ReviewQueue />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/equivalences" element={<EquivalencesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
