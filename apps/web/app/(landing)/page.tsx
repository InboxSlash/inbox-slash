import type {Metadata} from "next";
import {redirect} from 'next/navigation'

export const metadata: Metadata = {
    alternates: {canonical: "/"},
};

export default function Home() {
    redirect(`/login`);
}
