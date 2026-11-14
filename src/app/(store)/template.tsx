"use client";

import { motion } from "framer-motion";

/**
 * Soft fade between routes. Opacity only — animating transform here would make
 * the page wrapper a containing block and break `position: fixed` children
 * (mobile sticky purchase / checkout bars) while the transition runs.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25, ease: "easeOut" }}>
      {children}
    </motion.div>
  );
}
