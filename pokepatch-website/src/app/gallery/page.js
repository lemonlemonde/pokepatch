import SectionHeading from "@/components/SectionHeading";
import GalleryContent from "@/components/GalleryContent";

const galleryItems = [
  {
    title: "Mewtwo",
    description: "Major creases and surface scratches.",
    beforeFront: "/gallery/mewtwo-before-front.webp",
    beforeFrontVideo: "/gallery/mewtwo-before-front.mp4",
    beforeBack: "/gallery/mewtwo-before-back.webp",
    beforeBackVideo: "/gallery/mewtwo-before-back.mp4",
    afterFront: "/gallery/mewtwo-after-front.webp",
    afterFrontVideo: "/gallery/mewtwo-after-front.mp4",
    afterBack: "/gallery/mewtwo-after-back.webp",
    afterBackVideo: "/gallery/mewtwo-after-back.mp4",
    pairedVideoLayout: true,
  },
  {
    title: "Scizor",
    description: "Edge lift and creases.",
    beforeFront: "/gallery/scizor-before-front.webp",
    beforeFrontVideo: "/gallery/scizor-before-front.mp4",
    beforeBack: "/gallery/scizor-before-back.webp",
    beforeBackVideo: "/gallery/scizor-before-back.mp4",
    afterFront: "/gallery/scizor-after-front.webp",
    afterFrontVideo: "/gallery/scizor-after-front.mp4",
    afterBack: "/gallery/scizor-after-back.webp",
    afterBackVideo: "/gallery/scizor-after-back.mp4",
    pairedVideoLayout: true,
  },
  {
    title: "Reshiram",
    description: "Edge lifting and dirt.",
    beforeFront: "/gallery/reshiram-before-front.webp",
    beforeBack: "/gallery/reshiram-before-back.webp",
    afterFront: "/gallery/reshiram-after-front.webp",
    afterBack: "/gallery/reshiram-after-back.webp",
  },
  {
    title: "Rayquaza",
    description: "Crease on the right.",
    beforeFront: "/gallery/rayquaza-before-front.webp",
    beforeFrontVideo: "/gallery/rayquaza-before-front.mp4",
    beforeBack: "/gallery/rayquaza-before-back.webp",
    beforeBackVideo: "/gallery/rayquaza-before-back.mp4",
    afterFront: "/gallery/rayquaza-after-front.webp",
    afterFrontVideo: "/gallery/rayquaza-after-front.mp4",
    afterBack: "/gallery/rayquaza-after-back.webp",
    afterBackVideo: "/gallery/rayquaza-after-back.mp4",
    pairedVideoLayout: true,
  },
  {
    title: "Pikachu",
    description: "Small dent on the bottom.",
    beforeFront: "/gallery/pikachu-before-front.webp",
    beforeFrontVideo: "/gallery/pikachu-before-front.mp4",
    beforeBack: "/gallery/pikachu-before-back.webp",
    beforeBackVideo: "/gallery/pikachu-before-back.mp4",
    afterFront: "/gallery/pikachu-after-front.webp",
    afterFrontVideo: "/gallery/pikachu-after-front.mp4",
    afterBack: "/gallery/pikachu-after-back.webp",
    afterBackVideo: "/gallery/pikachu-after-back.mp4",
    pairedVideoLayout: true,
  },
];

export default function GalleryPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="animate-fade-up">
        <SectionHeading subtitle="Real restorations from our workshop.">
          Gallery
        </SectionHeading>
      </div>

      <GalleryContent items={galleryItems} />
    </div>
  );
}
