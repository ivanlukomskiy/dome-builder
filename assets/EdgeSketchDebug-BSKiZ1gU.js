import{i as e}from"./rolldown-runtime-Dd_uD5pT.js";import{At as t,Ba as n,Bo as r,Gr as i,Ha as a,Ho as o,Kn as s,Qo as c,Rr as l,Ua as u,Vo as d,Vr as f,Wr as p,Za as m,_r as h,er as g,jo as _,mo as v,pt as y,qn as b,wn as x}from"./polyhedra-Bk-soqAc.js";import{t as S}from"./PerspectiveCamera-nIiSckGm.js";import{a as ee,d as te,h as ne,l as re,m as C,p as w,s as ie,t as ae,u as T}from"./index-Co8erJkU.js";var E=e(ne(),1),D=new y,O=new d,k=class extends s{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type=`LineSegmentsGeometry`,this.setIndex([0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5]),this.setAttribute(`position`,new x([-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],3)),this.setAttribute(`uv`,new x([-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],2))}applyMatrix4(e){let t=this.attributes.instanceStart,n=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),n.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new b(t,6,1);return this.setAttribute(`instanceStart`,new g(n,3,0)),this.setAttribute(`instanceEnd`,new g(n,3,3)),this.instanceCount=this.attributes.instanceStart.count,this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new b(t,6,1);return this.setAttribute(`instanceColorStart`,new g(n,3,0)),this.setAttribute(`instanceColorEnd`,new g(n,3,3)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new c(e.geometry)),this}fromLineSegments(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new y);let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;e!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(e),D.setFromBufferAttribute(t),this.boundingBox.union(D))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new m),this.boundingBox===null&&this.computeBoundingBox();let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(e!==void 0&&t!==void 0){let n=this.boundingSphere.center;this.boundingBox.getCenter(n);let r=0;for(let i=0,a=e.count;i<a;i++)O.fromBufferAttribute(e,i),r=Math.max(r,n.distanceToSquared(O)),O.fromBufferAttribute(t,i),r=Math.max(r,n.distanceToSquared(O));this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error(`THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.`,this)}}toJSON(){}};C.line={worldUnits:{value:1},linewidth:{value:1},resolution:{value:new r},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}},w.line={uniforms:_.merge([C.common,C.fog,C.line]),vertexShader:`
		#include <common>
		#include <color_pars_vertex>
		#include <fog_pars_vertex>
		#include <logdepthbuf_pars_vertex>
		#include <clipping_planes_pars_vertex>

		uniform float linewidth;
		uniform vec2 resolution;

		attribute vec3 instanceStart;
		attribute vec3 instanceEnd;

		attribute vec3 instanceColorStart;
		attribute vec3 instanceColorEnd;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH

				varying vec2 vUv;

			#endif

		#else

			varying vec2 vUv;

		#endif

		#ifdef USE_DASH

			uniform float dashScale;
			attribute float instanceDistanceStart;
			attribute float instanceDistanceEnd;
			varying float vLineDistance;

		#endif

		float trimSegmentAlpha( const in vec4 start, const in vec4 end ) {

			// compute the interpolation factor needed to trim the segment so it terminates
			// between the camera plane and the near plane

			// conservative estimate of the near plane
			float a = projectionMatrix[ 2 ][ 2 ]; // 3nd entry in 3th column
			float b = projectionMatrix[ 3 ][ 2 ]; // 3nd entry in 4th column

			// we need different nearEstimate formula for reversed and default depth buffer
			// a is positive with a reversed depth buffer so it can be used for controlling the code flow
			float nearEstimate = ( a > 0.0 ) ? ( - b / ( a + 1.0 ) ) : ( - 0.5 * b / a );

			return ( nearEstimate - start.z ) / ( end.z - start.z );

		}

		void main() {

			#ifdef USE_COLOR

				vColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

			#endif

			float aspect = resolution.x / resolution.y;

			// camera space
			vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
			vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

			#ifdef USE_DASH

				float lineDistanceStart = dashScale * instanceDistanceStart;
				float lineDistanceEnd = dashScale * instanceDistanceEnd;

			#endif

			#ifdef WORLD_UNITS

				worldStart = start.xyz;
				worldEnd = end.xyz;

			#else

				vUv = uv;

			#endif

			// special case for perspective projection, and segments that terminate either in, or behind, the camera plane
			// clearly the gpu firmware has a way of addressing this issue when projecting into ndc space
			// but we need to perform ndc-space calculations in the shader, so we must address this issue directly
			// perhaps there is a more elegant solution -- WestLangley

			bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ); // 4th entry in the 3rd column

			if ( perspective ) {

				if ( start.z < 0.0 && end.z >= 0.0 ) {

					float alpha = trimSegmentAlpha( start, end );
					end.xyz = mix( start.xyz, end.xyz, alpha );

					#ifdef USE_DASH

						lineDistanceEnd = mix( lineDistanceStart, lineDistanceEnd, alpha );

					#endif

				} else if ( end.z < 0.0 && start.z >= 0.0 ) {

					float alpha = trimSegmentAlpha( end, start );
					start.xyz = mix( end.xyz, start.xyz, alpha );

					#ifdef USE_DASH

						lineDistanceStart = mix( lineDistanceEnd, lineDistanceStart, alpha );

					#endif

				}

			}

			#ifdef USE_DASH

				vLineDistance = ( position.y < 0.5 ) ? lineDistanceStart : lineDistanceEnd;
				vUv = uv;

			#endif

			// clip space
			vec4 clipStart = projectionMatrix * start;
			vec4 clipEnd = projectionMatrix * end;

			// ndc space
			vec3 ndcStart = clipStart.xyz / clipStart.w;
			vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

			// direction
			vec2 dir = ndcEnd.xy - ndcStart.xy;

			// account for clip-space aspect ratio
			dir.x *= aspect;
			dir = normalize( dir );

			#ifdef WORLD_UNITS

				vec3 worldDir = normalize( end.xyz - start.xyz );
				vec3 tmpFwd = normalize( mix( start.xyz, end.xyz, 0.5 ) );
				vec3 worldUp = normalize( cross( worldDir, tmpFwd ) );
				vec3 worldFwd = cross( worldDir, worldUp );
				worldPos = position.y < 0.5 ? start: end;

				// height offset
				float hw = linewidth * 0.5;
				worldPos.xyz += position.x < 0.0 ? hw * worldUp : - hw * worldUp;

				// don't extend the line if we're rendering dashes because we
				// won't be rendering the endcaps
				#ifndef USE_DASH

					// cap extension
					worldPos.xyz += position.y < 0.5 ? - hw * worldDir : hw * worldDir;

					// add width to the box
					worldPos.xyz += worldFwd * hw;

					// endcaps
					if ( position.y > 1.0 || position.y < 0.0 ) {

						worldPos.xyz -= worldFwd * 2.0 * hw;

					}

				#endif

				// project the worldpos
				vec4 clip = projectionMatrix * worldPos;

				// shift the depth of the projected points so the line
				// segments overlap neatly
				vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;
				clip.z = clipPose.z * clip.w;

			#else

				vec2 offset = vec2( dir.y, - dir.x );
				// undo aspect ratio adjustment
				dir.x /= aspect;
				offset.x /= aspect;

				// sign flip
				if ( position.x < 0.0 ) offset *= - 1.0;

				// endcaps
				if ( position.y < 0.0 ) {

					offset += - dir;

				} else if ( position.y > 1.0 ) {

					offset += dir;

				}

				// adjust for linewidth
				offset *= linewidth;

				// adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...
				offset /= resolution.y;

				// select end
				vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

				// back to clip space
				offset *= clip.w;

				clip.xy += offset;

			#endif

			gl_Position = clip;

			vec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation

			#include <logdepthbuf_vertex>
			#include <clipping_planes_vertex>
			#include <fog_vertex>

		}
		`,fragmentShader:`
		uniform vec3 diffuse;
		uniform float opacity;
		uniform float linewidth;

		#ifdef USE_DASH

			uniform float dashOffset;
			uniform float dashSize;
			uniform float gapSize;

		#endif

		varying float vLineDistance;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH

				varying vec2 vUv;

			#endif

		#else

			varying vec2 vUv;

		#endif

		#include <common>
		#include <color_pars_fragment>
		#include <fog_pars_fragment>
		#include <logdepthbuf_pars_fragment>
		#include <clipping_planes_pars_fragment>

		vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {

			float mua;
			float mub;

			vec3 p13 = p1 - p3;
			vec3 p43 = p4 - p3;

			vec3 p21 = p2 - p1;

			float d1343 = dot( p13, p43 );
			float d4321 = dot( p43, p21 );
			float d1321 = dot( p13, p21 );
			float d4343 = dot( p43, p43 );
			float d2121 = dot( p21, p21 );

			float denom = d2121 * d4343 - d4321 * d4321;

			float numer = d1343 * d4321 - d1321 * d4343;

			mua = numer / denom;
			mua = clamp( mua, 0.0, 1.0 );
			mub = ( d1343 + d4321 * ( mua ) ) / d4343;
			mub = clamp( mub, 0.0, 1.0 );

			return vec2( mua, mub );

		}

		void main() {

			float alpha = opacity;
			vec4 diffuseColor = vec4( diffuse, alpha );

			#include <clipping_planes_fragment>

			#ifdef USE_DASH

				if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps

				if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX

			#endif

			#ifdef WORLD_UNITS

				// Find the closest points on the view ray and the line segment
				vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;
				vec3 lineDir = worldEnd - worldStart;
				vec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );

				vec3 p1 = worldStart + lineDir * params.x;
				vec3 p2 = rayEnd * params.y;
				vec3 delta = p1 - p2;
				float len = length( delta );
				float norm = len / linewidth;

				#ifndef USE_DASH

					#ifdef USE_ALPHA_TO_COVERAGE

						float dnorm = fwidth( norm );
						alpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );

					#else

						if ( norm > 0.5 ) {

							discard;

						}

					#endif

				#endif

			#else

				#ifdef USE_ALPHA_TO_COVERAGE

					// artifacts appear on some hardware if a derivative is taken within a conditional
					float a = vUv.x;
					float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
					float len2 = a * a + b * b;
					float dlen = fwidth( len2 );

					if ( abs( vUv.y ) > 1.0 ) {

						alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );

					}

				#else

					if ( abs( vUv.y ) > 1.0 ) {

						float a = vUv.x;
						float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
						float len2 = a * a + b * b;

						if ( len2 > 1.0 ) discard;

					}

				#endif

			#endif

			#include <logdepthbuf_fragment>
			#include <color_fragment>

			gl_FragColor = vec4( diffuseColor.rgb, alpha );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>
			#include <fog_fragment>
			#include <premultiplied_alpha_fragment>

		}
		`};var A=class extends n{constructor(e){super({type:`LineMaterial`,uniforms:_.clone(w.line.uniforms),vertexShader:w.line.vertexShader,fragmentShader:w.line.fragmentShader,clipping:!0}),this.isLineMaterial=!0,this.setValues(e)}get color(){return this.uniforms.diffuse.value}set color(e){this.uniforms.diffuse.value=e}get worldUnits(){return`WORLD_UNITS`in this.defines}set worldUnits(e){e===!0!==this.worldUnits&&(this.needsUpdate=!0),e===!0?this.defines.WORLD_UNITS=``:delete this.defines.WORLD_UNITS}get linewidth(){return this.uniforms.linewidth.value}set linewidth(e){this.uniforms.linewidth&&(this.uniforms.linewidth.value=e)}get dashed(){return`USE_DASH`in this.defines}set dashed(e){e===!0!==this.dashed&&(this.needsUpdate=!0),e===!0?this.defines.USE_DASH=``:delete this.defines.USE_DASH}get dashScale(){return this.uniforms.dashScale.value}set dashScale(e){this.uniforms.dashScale.value=e}get dashSize(){return this.uniforms.dashSize.value}set dashSize(e){this.uniforms.dashSize.value=e}get dashOffset(){return this.uniforms.dashOffset.value}set dashOffset(e){this.uniforms.dashOffset.value=e}get gapSize(){return this.uniforms.gapSize.value}set gapSize(e){this.uniforms.gapSize.value=e}get opacity(){return this.uniforms.opacity.value}set opacity(e){this.uniforms&&(this.uniforms.opacity.value=e)}get resolution(){return this.uniforms.resolution.value}set resolution(e){this.uniforms.resolution.value.copy(e)}get alphaToCoverage(){return`USE_ALPHA_TO_COVERAGE`in this.defines}set alphaToCoverage(e){this.defines&&(e===!0!==this.alphaToCoverage&&(this.needsUpdate=!0),e===!0?this.defines.USE_ALPHA_TO_COVERAGE=``:delete this.defines.USE_ALPHA_TO_COVERAGE)}},j=new o,M=new d,N=new d,P=new o,F=new o,I=new o,L=new d,R=new p,z=new h,B=new d,V=new y,H=new m,U=new o,W,G;function K(e,t,n){return U.set(0,0,-t,1).applyMatrix4(e.projectionMatrix),U.multiplyScalar(1/U.w),U.x=G/n.width,U.y=G/n.height,U.applyMatrix4(e.projectionMatrixInverse),U.multiplyScalar(1/U.w),Math.abs(Math.max(U.x,U.y))}function oe(e,t){let n=e.matrixWorld,r=e.geometry,i=r.attributes.instanceStart,a=r.attributes.instanceEnd,o=Math.min(r.instanceCount,i.count);for(let r=0,s=o;r<s;r++){z.start.fromBufferAttribute(i,r),z.end.fromBufferAttribute(a,r),z.applyMatrix4(n);let o=new d,s=new d;W.distanceSqToSegment(z.start,z.end,s,o),s.distanceTo(o)<G*.5&&t.push({point:s,pointOnLine:o,distance:W.origin.distanceTo(s),object:e,face:null,faceIndex:r,uv:null,uv1:null})}}function se(e,t,n){let r=t.projectionMatrix,i=e.material.resolution,a=e.matrixWorld,o=e.geometry,s=o.attributes.instanceStart,c=o.attributes.instanceEnd,l=Math.min(o.instanceCount,s.count),u=-t.near;W.at(1,I),I.w=1,I.applyMatrix4(t.matrixWorldInverse),I.applyMatrix4(r),I.multiplyScalar(1/I.w),I.x*=i.x/2,I.y*=i.y/2,I.z=0,L.copy(I),R.multiplyMatrices(t.matrixWorldInverse,a);for(let t=0,o=l;t<o;t++){if(P.fromBufferAttribute(s,t),F.fromBufferAttribute(c,t),P.w=1,F.w=1,P.applyMatrix4(R),F.applyMatrix4(R),P.z>u&&F.z>u)continue;if(P.z>u){let e=P.z-F.z,t=(P.z-u)/e;P.lerp(F,t)}else if(F.z>u){let e=F.z-P.z,t=(F.z-u)/e;F.lerp(P,t)}P.applyMatrix4(r),F.applyMatrix4(r),P.multiplyScalar(1/P.w),F.multiplyScalar(1/F.w),P.x*=i.x/2,P.y*=i.y/2,F.x*=i.x/2,F.y*=i.y/2,z.start.copy(P),z.start.z=0,z.end.copy(F),z.end.z=0;let o=z.closestPointToPointParameter(L,!0);z.at(o,B);let l=f.lerp(P.z,F.z,o),p=l>=-1&&l<=1,m=L.distanceTo(B)<G*.5;if(p&&m){z.start.fromBufferAttribute(s,t),z.end.fromBufferAttribute(c,t),z.start.applyMatrix4(a),z.end.applyMatrix4(a);let r=new d,i=new d;W.distanceSqToSegment(z.start,z.end,i,r),n.push({point:i,pointOnLine:r,distance:W.origin.distanceTo(i),object:e,face:null,faceIndex:t,uv:null,uv1:null})}}}var ce=class extends i{constructor(e=new k,t=new A({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type=`LineSegments2`}computeLineDistances(){let e=this.geometry,t=e.attributes.instanceStart,n=e.attributes.instanceEnd,r=new Float32Array(2*t.count);for(let e=0,i=0,a=t.count;e<a;e++,i+=2)M.fromBufferAttribute(t,e),N.fromBufferAttribute(n,e),r[i]=i===0?0:r[i-1],r[i+1]=r[i]+M.distanceTo(N);let i=new b(r,2,1);return e.setAttribute(`instanceDistanceStart`,new g(i,1,0)),e.setAttribute(`instanceDistanceEnd`,new g(i,1,1)),this}raycast(e,t){let n=this.material.worldUnits,r=e.camera;if(r===null&&!n&&console.error(`LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.`),n===!1&&(this.material.resolution.x===0||this.material.resolution.y===0))return;let i=e.params.Line2===void 0?0:e.params.Line2.threshold||0;W=e.ray;let a=this.matrixWorld,o=this.geometry,s=this.material;G=s.linewidth+i,o.boundingSphere===null&&o.computeBoundingSphere(),H.copy(o.boundingSphere).applyMatrix4(a);let c;if(c=n?G*.5:K(r,Math.max(r.near,H.distanceToPoint(W.origin)),s.resolution),H.radius+=c,W.intersectsSphere(H)===!1)return;o.boundingBox===null&&o.computeBoundingBox(),V.copy(o.boundingBox).applyMatrix4(a);let l;l=n?G*.5:K(r,Math.max(r.near,V.distanceToPoint(W.origin)),s.resolution),V.expandByScalar(l),W.intersectsBox(V)!==!1&&(n?oe(this,t):se(this,r,t))}onBeforeRender(e){let t=this.material.uniforms;t&&t.resolution&&(e.getViewport(j),this.material.uniforms.resolution.value.set(j.z,j.w))}},q=class extends k{constructor(){super(),this.isLineGeometry=!0,this.type=`LineGeometry`}setPositions(e){let t=e.length-3,n=new Float32Array(2*t);for(let r=0;r<t;r+=3)n[2*r]=e[r],n[2*r+1]=e[r+1],n[2*r+2]=e[r+2],n[2*r+3]=e[r+3],n[2*r+4]=e[r+4],n[2*r+5]=e[r+5];return super.setPositions(n),this}setColors(e){let t=e.length-3,n=new Float32Array(2*t);for(let r=0;r<t;r+=3)n[2*r]=e[r],n[2*r+1]=e[r+1],n[2*r+2]=e[r+2],n[2*r+3]=e[r+3],n[2*r+4]=e[r+4],n[2*r+5]=e[r+5];return super.setColors(n),this}setFromPoints(e){let t=e.length-1,n=new Float32Array(6*t);for(let r=0;r<t;r++)n[6*r]=e[r].x,n[6*r+1]=e[r].y,n[6*r+2]=e[r].z||0,n[6*r+3]=e[r+1].x,n[6*r+4]=e[r+1].y,n[6*r+5]=e[r+1].z||0;return super.setPositions(n),this}fromLine(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}},le=class extends ce{constructor(e=new q,t=new A({color:Math.random()*16777215})){super(e,t),this.isLine2=!0,this.type=`Line2`}},J=te(),Y=Math.PI/180,ue=`#5b9bd5`,de=`#f5a623`,fe=`#2dd4bf`,pe=`#e0729f`,me=`#5c6270`,he=`#f5e050`,ge=`#4fd97e`;function _e(e,t){let n=Math.cos(t),r=Math.sin(t);return[e[0]*n-e[1]*r,e[0]*r+e[1]*n]}function ve(e){let t=e;for(;t<=-Math.PI;)t+=2*Math.PI;for(;t>Math.PI;)t-=2*Math.PI;return t}function ye(e,t,n){let r=2*(e[0]*(t[1]-n[1])+t[0]*(n[1]-e[1])+n[0]*(e[1]-t[1])),i=e[0]*e[0]+e[1]*e[1],a=t[0]*t[0]+t[1]*t[1],o=n[0]*n[0]+n[1]*n[1];return[(i*(t[1]-n[1])+a*(n[1]-e[1])+o*(e[1]-t[1]))/r,(i*(n[0]-t[0])+a*(e[0]-n[0])+o*(t[0]-e[0]))/r]}function be(e,t,n,r=32){let i=ye(e,t,n),a=Math.hypot(e[0]-i[0],e[1]-i[1]),o=Math.atan2(e[1]-i[1],e[0]-i[0]),s=Math.atan2(t[1]-i[1],t[0]-i[0]),c=Math.atan2(n[1]-i[1],n[0]-i[0]),l=ve(s-o)+ve(c-s),u=[];for(let e=0;e<=r;e++){let t=o+e/r*l;u.push([i[0]+a*Math.cos(t),i[1]+a*Math.sin(t)])}return u}function X(e,t){let n=t(e.start),r=[new d(n[0],n[1],0)],i=n;for(let{to:n,seg:a}of e.path){let e=t(n);if(a.kind===`line`)r.push(new d(e[0],e[1],0));else{let n=t(a.via);for(let t of be(i,n,e).slice(1))r.push(new d(t[0],t[1],0))}i=e}return r}function xe(e,t,n=!1){let r=[],i=t(e.start),a=i,o=(e,t,n)=>{let i=(t===`line`?[a,e]:be(a,n,e)).map(e=>new d(e[0],e[1],0)),o=r[r.length-1];o&&o.kind===t?o.points.push(...i.slice(1)):r.push({kind:t,points:i}),a=e};for(let{to:n,seg:r}of e.path){let e=t(n);r.kind===`line`?o(e,`line`):o(e,`arc`,t(r.via))}return n&&o(i,`line`),r}function Se(e,t=96){let n=[];for(let r=0;r<=t;r++){let i=r/t*Math.PI*2;n.push(new d(e*Math.cos(i),e*Math.sin(i),-1))}return n}function Z({points:e,color:n,z:i=0,width:a=3,dashed:o=!1,closed:s=!1}){let{size:c}=re(e=>e),l=(0,E.useMemo)(()=>{let l=[],u=s?[...e,e[0]]:e;for(let e of u)l.push(e.x,e.y,i);let d=new q;d.setPositions(l);let f=new le(d,new A({color:new t(n).getHex(),linewidth:a,dashed:o,dashSize:14,gapSize:10,resolution:new r(c.width,c.height)}));return o&&f.computeLineDistances(),f},[e,i,n,a,o,s,c.width,c.height]);return(0,J.jsx)(`primitive`,{object:l})}function Q({position:e,color:t}){return(0,J.jsxs)(`mesh`,{position:[e[0],e[1],1],children:[(0,J.jsx)(`circleGeometry`,{args:[18,24]}),(0,J.jsx)(`meshBasicMaterial`,{color:t})]})}function Ce({boundary:e,centerline:t,vertexA:n,vertexB:i,radius:o,angleDeg:s}){let c=(0,E.useMemo)(()=>Math.PI/2-s*Y/2,[s]),l=(0,E.useMemo)(()=>e=>_e(e,c),[c]),f=(0,E.useMemo)(()=>X(e,l),[e,l]),p=(0,E.useMemo)(()=>X(t,l),[t,l]),m=(0,E.useMemo)(()=>xe(e,l,!0),[e,l]),h=(0,E.useMemo)(()=>xe(t,l),[t,l]),g=(0,E.useMemo)(()=>Se(o),[o]),_=(0,E.useMemo)(()=>{let e=new a(f.map(e=>new r(e.x,e.y)));return new u(e)},[f]),v=l(n),y=l(i),b=[0,0],x=(0,E.useMemo)(()=>[new d(v[0],v[1],0),p[0]],[v,p]),S=(0,E.useMemo)(()=>[p[p.length-1],new d(y[0],y[1],0)],[y,p]);return(0,J.jsxs)(`group`,{children:[(0,J.jsx)(Z,{points:g,color:me,width:1.5,dashed:!0,closed:!0}),(0,J.jsx)(`mesh`,{geometry:_,position:[0,0,0],children:(0,J.jsx)(`meshBasicMaterial`,{color:ue,transparent:!0,opacity:.2,side:2})}),m.map((e,t)=>(0,J.jsx)(Z,{points:e.points,color:e.kind===`arc`?fe:ue,z:.1,width:3},`boundary-${t}`)),h.map((e,t)=>(0,J.jsx)(Z,{points:e.points,color:e.kind===`arc`?fe:de,z:.2,width:4,dashed:!0},`centerline-${t}`)),(0,J.jsx)(Z,{points:x,color:pe,z:.2,width:4,dashed:!0}),(0,J.jsx)(Z,{points:S,color:pe,z:.2,width:4,dashed:!0}),(0,J.jsx)(Q,{position:b,color:he}),(0,J.jsx)(Q,{position:v,color:ge}),(0,J.jsx)(Q,{position:y,color:ge})]})}function we(e){let[t]=(0,E.useState)(()=>{let t=Math.PI/2-e.angleDeg*Y/2,n=e=>_e(e,t),r=[...X(e.boundary,n),...X(e.centerline,n)],i=r.map(e=>e.x),a=r.map(e=>e.y),o=Math.min(...i),s=Math.max(...i),c=Math.min(...a),l=Math.max(...a),u=s-o,d=l-c,f=Math.max(u,d,100)/2/Math.tan(45*Y/2)*1.7;return{target:[(o+s)/2,(c+l)/2,0],distance:f,fov:45}});return t}function Te(e){let{target:t,distance:n,fov:r}=we(e);return(0,J.jsxs)(ie,{children:[(0,J.jsx)(`color`,{attach:`background`,args:[`#12141a`]}),(0,J.jsx)(S,{makeDefault:!0,position:[t[0],t[1],t[2]+n],up:[0,1,0],fov:r,near:1,far:n*100}),(0,J.jsx)(ee,{makeDefault:!0,enableRotate:!1,target:t,enableDamping:!0,dampingFactor:.08,mouseButtons:{LEFT:l.PAN,MIDDLE:l.DOLLY,RIGHT:l.PAN},touches:{ONE:v.PAN,TWO:v.DOLLY_PAN}}),(0,J.jsx)(Ce,{...e})]})}var $=Math.PI/180,Ee={offset1:100,offset2:100,width:125,cornerLength:375,radius:2500,angleDeg:60,toothHeight:30,toothLength:60,toothChamfer:8,millRadius:6};function De(){let[e,t]=(0,E.useState)(Ee),n=e=>n=>t(t=>({...t,[e]:n})),r=(0,E.useMemo)(()=>{let{radius:t,angleDeg:n,offset1:r,offset2:i,cornerLength:a,width:o,toothHeight:s,toothLength:c,toothChamfer:l,millRadius:u}=e,f=new d(0,0,0),p=n*$,m=new d(t,0,0),h=new d(t*Math.cos(p),t*Math.sin(p),0);return ae(m,h,f,r,i,a,o/2,{height:s,length:c,chamfer:l,millRadius:u})},[e]),i=[e.radius,0],a=[e.radius*Math.cos(e.angleDeg*$),e.radius*Math.sin(e.angleDeg*$)];return(0,J.jsxs)(`div`,{className:`app`,children:[(0,J.jsxs)(`aside`,{className:`sidebar`,children:[(0,J.jsx)(`h1`,{children:`Edge Sketch Debug`}),(0,J.jsx)(`div`,{className:`button-row`,children:(0,J.jsx)(`a`,{href:`/dome-builder/`,children:`← Back to builder`})}),(0,J.jsxs)(`section`,{className:`control-group`,children:[(0,J.jsx)(`h2`,{children:`Vertex Placement`}),(0,J.jsxs)(`div`,{className:`transform-field`,children:[(0,J.jsx)(`label`,{children:`Radius from center (mm)`}),(0,J.jsx)(T,{value:e.radius,step:50,min:1,onCommit:n(`radius`)})]}),(0,J.jsxs)(`div`,{className:`transform-field`,children:[(0,J.jsx)(`label`,{children:`Angle between radiuses (deg)`}),(0,J.jsx)(T,{value:e.angleDeg,step:1,onCommit:n(`angleDeg`)})]})]}),(0,J.jsxs)(`section`,{className:`control-group`,children:[(0,J.jsx)(`h2`,{children:`Edge End Offsets`}),(0,J.jsxs)(`div`,{className:`transform-field`,children:[(0,J.jsx)(`label`,{children:`Offset 1 (mm)`}),(0,J.jsx)(T,{value:e.offset1,step:5,min:0,onCommit:n(`offset1`)})]}),(0,J.jsxs)(`div`,{className:`transform-field`,children:[(0,J.jsx)(`label`,{children:`Offset 2 (mm)`}),(0,J.jsx)(T,{value:e.offset2,step:5,min:0,onCommit:n(`offset2`)})]})]}),(0,J.jsxs)(`section`,{className:`control-group`,children:[(0,J.jsx)(`h2`,{children:`Strut Shape`}),(0,J.jsxs)(`div`,{className:`transform-field`,children:[(0,J.jsx)(`label`,{children:`Width (mm)`}),(0,J.jsx)(T,{value:e.width,step:5,min:0,onCommit:n(`width`)})]}),(0,J.jsxs)(`div`,{className:`transform-field`,children:[(0,J.jsx)(`label`,{children:`Corner length (mm)`}),(0,J.jsx)(T,{value:e.cornerLength,step:5,min:0,onCommit:n(`cornerLength`)})]})]}),(0,J.jsxs)(`section`,{className:`control-group`,children:[(0,J.jsx)(`h2`,{children:`Corner Teeth`}),(0,J.jsxs)(`div`,{className:`transform-field`,children:[(0,J.jsx)(`label`,{children:`Tooth height (mm)`}),(0,J.jsx)(T,{value:e.toothHeight,step:5,min:0,onCommit:n(`toothHeight`)})]}),(0,J.jsxs)(`div`,{className:`transform-field`,children:[(0,J.jsx)(`label`,{children:`Tooth length (mm)`}),(0,J.jsx)(T,{value:e.toothLength,step:5,min:0,onCommit:n(`toothLength`)})]}),(0,J.jsxs)(`div`,{className:`transform-field`,children:[(0,J.jsx)(`label`,{children:`Chamfer length (mm)`}),(0,J.jsx)(T,{value:e.toothChamfer,step:1,min:0,onCommit:n(`toothChamfer`)})]}),(0,J.jsxs)(`div`,{className:`transform-field`,children:[(0,J.jsx)(`label`,{children:`Mill radius (mm)`}),(0,J.jsx)(T,{value:e.millRadius,step:1,min:0,onCommit:n(`millRadius`)})]}),(0,J.jsx)(`p`,{className:`hint`,children:`A tooth appears at each vertex end, on both the outer and inner boundary (mirrored across the centerline). 0 height turns it off. The mill radius sets a dogbone relief cut into the main line at each of the tooth's two concave base corners - the corner itself stays sharp, but a real round cutting bit can't reach all the way into it, so a semicircle is cut in just before, leaving room for a square mating part to seat flush.`})]}),(0,J.jsxs)(`section`,{className:`control-group`,children:[(0,J.jsx)(`h2`,{children:`Legend`}),(0,J.jsx)(`p`,{className:`hint`,style:{color:`#5b9bd5`},children:`Boundary - the actual sketch outline`}),(0,J.jsx)(`p`,{className:`hint`,style:{color:`#f5a623`},children:`Centerline - the trimmed, mitered main line`}),(0,J.jsx)(`p`,{className:`hint`,style:{color:`#2dd4bf`},children:`Arc section - of either line above`}),(0,J.jsx)(`p`,{className:`hint`,style:{color:`#e0729f`},children:`Offset line - vertex to where the centerline starts`})]})]}),(0,J.jsx)(`div`,{className:`viewport`,children:r?(0,J.jsx)(Te,{boundary:r,centerline:r.centerline,vertexA:i,vertexB:a,radius:e.radius,angleDeg:e.angleDeg}):(0,J.jsx)(`div`,{className:`hud`,children:`Degenerate configuration - a vertex sits on the gravity center.`})})]})}export{De as EdgeSketchDebug};